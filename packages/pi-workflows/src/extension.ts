import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Action, begin, canExecute, recordGoalRole, recordResearchReview, transition } from "./engine.ts";
import { measureJson } from "./research.ts";
import { runRole } from "./roles.ts";
import { digest, loadState, type Mode, type Role, saveState, statePath, type WorkflowState } from "./state.ts";

const modes: Mode[] = ["deep-interview", "ralplan", "ultragoal", "autoresearch"];
const readTools = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"gjc_workflow",
	"gjc_role",
	"gjc_research_fetch",
	"gjc_research_measure",
]);
const textResult = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
const ownerOf = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();
function verdictOf(output: string): string | undefined {
	return Array.from(output.matchAll(/^Verdict:\s*(CLEAR|APPROVE|REVISE|OKAY)\s*$/gim))
		.at(-1)?.[1]
		?.toUpperCase();
}
function summarize(state: WorkflowState | undefined): string {
	if (!state) return "No GJC workflow active in this Pi session.";
	const fields = [`${state.mode}: ${state.status}`, `run=${state.id}`, `revision=${state.revision}`];
	if (state.plan) fields.push(`pass=${state.plan.pass}`, `planHash=${state.plan.hash ?? "none"}`);
	if (state.goals) fields.push(`goals=${state.goals.map(goal => `${goal.id}:${goal.status}`).join(",")}`);
	return fields.join(" | ");
}
function parseAction(raw: string): Action | { op: "status" } {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || !("op" in value) || typeof value.op !== "string")
		throw new Error("Action must be a JSON object with op");
	if (value.op === "approve" || value.op === "role")
		throw new Error("Approval and role receipts require their dedicated Pi command/tool");
	if (
		![
			"status",
			"answer",
			"crystallize",
			"revise",
			"finalize",
			"goals",
			"start_goal",
			"finish_goal",
			"block_goal",
			"intake",
			"evidence",
			"verdict",
			"pause",
			"resume",
		].includes(value.op)
	)
		throw new Error("Unknown workflow action");
	return value as Action;
}
function allowedRole(state: WorkflowState, role: Role): void {
	if (state.mode === "ralplan" && state.status === "active" && role !== "executor") return;
	if (state.mode === "ultragoal" && state.status === "active" && (role === "executor" || role === "critic")) return;
	if (
		state.mode === "autoresearch" &&
		state.status === "active" &&
		(role === "planner" || role === "architect" || role === "critic") &&
		(role !== "critic" || !!state.research?.evidence.length)
	)
		return;
	throw new Error(`${role} is not available in ${state.mode}/${state.status}`);
}
export default function gjcPiWorkflows(pi: ExtensionAPI): void {
	for (const mode of modes) {
		pi.registerCommand(`gjc-${mode}`, {
			description: `Start the GJC ${mode} workflow`,
			handler: async (args, ctx) => {
				const task = args.trim();
				if (!task) {
					ctx.ui.notify(`Usage: /gjc-${mode} <task>`, "error");
					return;
				}
				const owner = ownerOf(ctx);
				const previous = await loadState(ctx.cwd, owner);
				try {
					const state = begin(owner, mode, task, previous);
					await saveState(ctx.cwd, state, `begin:${mode}`);
					pi.appendEntry("gjc-pi-workflow", { run: state.id, mode, revision: state.revision });
					pi.sendUserMessage(`/skill:${mode} ${task}`, { expandPromptTemplates: true });
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
			},
		});
	}
	pi.registerCommand("gjc-status", {
		description: "Show the current GJC workflow",
		handler: async (_args, ctx) => ctx.ui.notify(summarize(await loadState(ctx.cwd, ownerOf(ctx))), "info"),
	});
	for (const command of ["pause", "resume"] as const) {
		pi.registerCommand(`gjc-${command}`, {
			description: `${command} the active GJC workflow`,
			handler: async (_args, ctx) => {
				const state = await loadState(ctx.cwd, ownerOf(ctx));
				if (!state) {
					ctx.ui.notify("No GJC workflow", "error");
					return;
				}
				try {
					const next = transition(state, { op: command });
					await saveState(ctx.cwd, next, command);
					pi.appendEntry("gjc-pi-workflow", {
						run: next.id,
						mode: next.mode,
						revision: next.revision,
						status: next.status,
					});
					ctx.ui.notify(summarize(next), "info");
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
			},
		});
	}
	pi.registerCommand("gjc-approve", {
		description: "Approve the current interview specification or final plan",
		handler: async (_args, ctx) => {
			const owner = ownerOf(ctx);
			const state = await loadState(ctx.cwd, owner);
			if (state?.status !== "pending-approval") {
				ctx.ui.notify("No pending GJC artifact", "error");
				return;
			}
			const hash = state.mode === "ralplan" ? state.plan?.hash : state.interview?.hash;
			if (!hash || !ctx.hasUI) {
				ctx.ui.notify("Interactive or RPC confirmation is required", "error");
				return;
			}
			const file = path.join(
				path.dirname(statePath(ctx.cwd, owner)),
				state.mode === "ralplan" ? "pending-approval.md" : "specification.md",
			);
			try {
				if (digest(await fs.readFile(file, "utf8")) !== hash)
					throw new Error("Artifact content differs from the current state");
			} catch (error) {
				ctx.ui.notify(`Cannot approve ${file}: ${String(error)}`, "error");
				return;
			}
			const approved = await ctx.ui.confirm(
				"Approve GJC artifact",
				`Review ${file}\nSHA-256: ${hash}\nApprove this exact artifact?`,
			);
			if (!approved) return;
			const fresh = await loadState(ctx.cwd, owner);
			if (
				!fresh ||
				fresh.revision !== state.revision ||
				(fresh.mode === "ralplan" ? fresh.plan?.hash : fresh.interview?.hash) !== hash ||
				digest(await fs.readFile(file, "utf8")) !== hash
			) {
				ctx.ui.notify("Artifact changed; review again", "error");
				return;
			}
			const next = transition(fresh, { op: "approve", hash, owner });
			await saveState(ctx.cwd, next, "approve");
			pi.appendEntry("gjc-pi-workflow-approval", { run: next.id, hash, owner });
			ctx.ui.notify(
				`Approved ${hash.slice(0, 12)}. ${next.mode === "ralplan" ? "Run /gjc-ultragoal <task> to execute the plan." : "Run /gjc-ralplan <task> to plan."}`,
				"info",
			);
		},
	});
	pi.registerTool({
		name: "gjc_research_measure",
		label: "GJC research measurement",
		description:
			"Compute bounded descriptive statistics from a local JSON array of numbers or records during data/hybrid autoresearch.",
		parameters: Type.Object({ file: Type.String(), field: Type.Optional(Type.String()) }),
		execute: async (_id, params, _signal, _update, ctx) => {
			const state = await loadState(ctx.cwd, ownerOf(ctx));
			if (
				state?.mode !== "autoresearch" ||
				state.status !== "active" ||
				!["data", "hybrid"].includes(state.research?.mode ?? "")
			)
				throw new Error("Data or hybrid research intake required");
			const file = path.resolve(ctx.cwd, params.file);
			const info = await fs.stat(file);
			if (!info.isFile() || info.size > 5_000_000)
				throw new Error("Data source must be a JSON file of at most 5 MB");
			const data: unknown = JSON.parse(await fs.readFile(file, "utf8"));
			return textResult(JSON.stringify({ file, field: params.field, ...measureJson(data, params.field) }));
		},
	});
	pi.registerTool({
		name: "gjc_research_fetch",
		label: "GJC research source",
		description:
			"Fetch a bounded text source for an active autoresearch mission. Record useful findings with gjc_workflow evidence.",
		parameters: Type.Object({ url: Type.String() }),
		execute: async (_id, params, signal, _update, ctx) => {
			const state = await loadState(ctx.cwd, ownerOf(ctx));
			if (state?.mode !== "autoresearch" || state.status !== "active" || !state.research?.mode)
				throw new Error("Research intake required before fetching sources");
			const url = new URL(params.url);
			if (url.protocol !== "http:" && url.protocol !== "https:")
				throw new Error("Only HTTP(S) sources are supported");
			const response = await fetch(url, {
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
			});
			if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
			const contentType = response.headers.get("content-type") ?? "";
			if (!/(text|json|xml)/i.test(contentType)) throw new Error(`Unsupported source type: ${contentType}`);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Source has no body");
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			try {
				while (bytes < 64000) {
					const part = await reader.read();
					if (part.done) break;
					chunks.push(part.value);
					bytes += part.value.byteLength;
				}
			} finally {
				await reader.cancel().catch(() => undefined);
			}
			const joined = new Uint8Array(Math.min(bytes, 64000));
			let offset = 0;
			for (const chunk of chunks) {
				joined.set(chunk.subarray(0, joined.length - offset), offset);
				offset = Math.min(joined.length, offset + chunk.length);
			}
			return textResult(`Source: ${url.href}\nContent-Type: ${contentType}\n${new TextDecoder().decode(joined)}`);
		},
	});
	pi.registerTool({
		name: "gjc_workflow",
		label: "GJC workflow",
		description:
			"Read or advance the active GJC workflow. Pass an action JSON object and the current revision. Approval is only through /gjc-approve.",
		parameters: Type.Object({ action: Type.String(), expectedRevision: Type.Optional(Type.Integer()) }),
		executionMode: "sequential",
		execute: async (_id, params, _signal, _update, ctx) => {
			const owner = ownerOf(ctx);
			const state = await loadState(ctx.cwd, owner);
			if (!state) throw new Error("Start a workflow with /gjc-<skill> first");
			const action = parseAction(params.action);
			if (action.op === "status") return textResult(JSON.stringify(state, null, 2));
			if (action.op === "pause" || action.op === "resume") throw new Error("Pause and resume require user commands");
			if (state.revision !== params.expectedRevision) throw new Error(`Stale revision; current=${state.revision}`);
			const next = transition(state, action);
			await saveState(ctx.cwd, next, action.op);
			pi.appendEntry("gjc-pi-workflow", {
				run: next.id,
				mode: next.mode,
				revision: next.revision,
				status: next.status,
			});
			return textResult(summarize(next));
		},
	});
	pi.registerTool({
		name: "gjc_role",
		label: "GJC role agent",
		description:
			"Run an isolated Pi role session. Planner, Architect, and Critic are read-only. Executor is available only for an active ultragoal.",
		parameters: Type.Object({
			role: Type.Union([
				Type.Literal("executor"),
				Type.Literal("planner"),
				Type.Literal("architect"),
				Type.Literal("critic"),
			]),
			task: Type.String(),
			expectedRevision: Type.Integer(),
		}),
		executionMode: "sequential",
		execute: async (_id, params, signal, _update, ctx) => {
			const owner = ownerOf(ctx);
			const state = await loadState(ctx.cwd, owner);
			if (!state || state.revision !== params.expectedRevision) throw new Error("Missing or stale workflow state");
			allowedRole(state, params.role);
			const activeGoal =
				state.mode === "ultragoal" ? state.goals?.find(goal => goal.status === "active") : undefined;
			if (state.mode === "ultragoal" && !activeGoal) throw new Error("Start a goal first");
			const assignment = `${state.task}\n\nWorkflow: ${state.mode}; run ${state.id}; revision ${state.revision}.\n${state.approvedPlan ? `Approved plan (${state.approvedPlan.hash}):\n${state.approvedPlan.content}` : ""}\n${state.plan ? `Current planner draft:\n${state.plan.draft?.content ?? "none"}\nArchitect review:\n${state.plan.architect?.content ?? "none"}\nCritic review:\n${state.plan.critic?.content ?? "none"}` : ""}\n${activeGoal ? `Active goal ${activeGoal.id}: ${activeGoal.description}\nExecutor evidence: ${activeGoal.executor?.content ?? "none"}` : ""}\n\nSpecific assignment:\n${params.task}`;
			const output = await runRole(params.role, assignment, pi, ctx, signal);
			const fresh = await loadState(ctx.cwd, owner);
			if (!fresh || fresh.id !== state.id || fresh.revision !== state.revision)
				throw new Error("Workflow changed while role ran; result not recorded");
			let next = fresh;
			if (fresh.mode === "ralplan")
				next = transition(fresh, { op: "role", role: params.role, content: output, verdict: verdictOf(output) });
			if (fresh.mode === "ultragoal") next = recordGoalRole(fresh, params.role as "executor" | "critic", output);
			if (fresh.mode === "autoresearch" && params.role === "critic") next = recordResearchReview(fresh, output);
			if (next !== fresh) await saveState(ctx.cwd, next, `role:${params.role}`);
			return textResult(`${params.role} receipt sha256=${digest(output)}\n${summarize(next)}\n\n${output}`);
		},
	});
	pi.on("tool_call", async (event, ctx) => {
		const state = await loadState(ctx.cwd, ownerOf(ctx));
		if (canExecute(state) || readTools.has(event.toolName)) return;
		return {
			block: true,
			reason: `GJC ${state?.mode} is ${state?.status}; only read tools and GJC workflow tools are allowed`,
		};
	});
	pi.on("user_bash", async (_event, ctx) => {
		const state = await loadState(ctx.cwd, ownerOf(ctx));
		if (canExecute(state)) return;
		return {
			result: {
				output: `Blocked while GJC ${state?.mode} is ${state?.status}`,
				exitCode: 1,
				cancelled: false,
				truncated: false,
			},
		};
	});
}
