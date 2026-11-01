import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type Mode = "deep-interview" | "ralplan" | "ultragoal" | "autoresearch";
export type Status = "active" | "pending-approval" | "approved" | "paused" | "blocked" | "complete" | "stuck";
export type Role = "executor" | "architect" | "planner" | "critic";
export interface Receipt {
	role: Role;
	content: string;
	verdict?: string;
	hash: string;
	at: string;
}
export interface Goal {
	id: string;
	description: string;
	status: "pending" | "active" | "complete" | "blocked";
	evidence?: string;
	critique?: string;
	executor?: Receipt;
	critic?: Receipt;
}
export interface WorkflowState {
	version: 1;
	id: string;
	owner: string;
	mode: Mode;
	status: Status;
	task: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	interview?: {
		round: number;
		answers: { question: string; answer: string; ambiguity: number }[];
		specification?: string;
		hash?: string;
	};
	plan?: {
		pass: number;
		draft?: Receipt;
		architect?: Receipt;
		critic?: Receipt;
		history: Receipt[];
		final?: string;
		hash?: string;
		approval?: { hash: string; at: string; owner: string };
	};
	goals?: Goal[];
	research?: {
		mission: string;
		mode?: "web" | "data" | "hybrid";
		constraints?: string[];
		deliverables?: string[];
		evidence: string[];
		review?: Receipt;
		reviewedEvidenceHash?: string;
		verdict?: {
			status: "supported" | "refuted" | "inconclusive";
			conclusion: string;
			caveats: string[];
			evaluator: "critic";
		};
	};
	approvedPlan?: { content: string; hash: string; sourceRun: string };
}

export function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
function safeId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
export function statePath(cwd: string, owner: string): string {
	return path.join(cwd, ".gjc", "pi-workflows", safeId(owner), "state.json");
}
function ledgerPath(cwd: string, owner: string): string {
	return path.join(path.dirname(statePath(cwd, owner)), "ledger.jsonl");
}
export async function loadState(cwd: string, owner: string): Promise<WorkflowState | undefined> {
	try {
		const state = JSON.parse(await fs.readFile(statePath(cwd, owner), "utf8")) as WorkflowState;
		if (state.version !== 1 || state.owner !== owner) throw new Error("Invalid workflow state");
		return state;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
export async function saveState(cwd: string, state: WorkflowState, event: string): Promise<void> {
	const target = statePath(cwd, state.owner);
	await fs.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.${randomUUID()}.tmp`;
	state.updatedAt = new Date().toISOString();
	await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
	await fs.rename(temp, target);
	if (state.mode === "ralplan" && state.plan?.final)
		await fs.writeFile(path.join(path.dirname(target), "pending-approval.md"), state.plan.final);
	if (state.mode === "deep-interview" && state.interview?.specification)
		await fs.writeFile(path.join(path.dirname(target), "specification.md"), state.interview.specification);
	await fs.appendFile(
		ledgerPath(cwd, state.owner),
		JSON.stringify({ at: state.updatedAt, id: state.id, revision: state.revision, event, status: state.status }) +
			"\n",
	);
}
export function newState(owner: string, mode: Mode, task: string): WorkflowState {
	const at = new Date().toISOString();
	const base: WorkflowState = {
		version: 1,
		id: randomUUID(),
		owner,
		mode,
		status: "active",
		task,
		revision: 0,
		createdAt: at,
		updatedAt: at,
	};
	if (mode === "deep-interview") base.interview = { round: 0, answers: [] };
	if (mode === "ralplan") base.plan = { pass: 1, history: [] };
	if (mode === "ultragoal") base.goals = [];
	if (mode === "autoresearch") base.research = { mission: task, evidence: [] };
	return base;
}
