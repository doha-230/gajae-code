import * as fs from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Role } from "./state.ts";

const allowed: Record<Role, string[]> = {
	executor: ["read", "grep", "find", "ls", "bash", "powershell", "edit", "write"],
	planner: ["read", "grep", "find", "ls"],
	architect: ["read", "grep", "find", "ls"],
	critic: ["read", "grep", "find", "ls"],
};

export async function runRole(role: Role, task: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<string> {
	if (!ctx.model) throw new Error("Select a Pi model before running a role");
	const prompt = await fs.readFile(new URL(`../agents/${role}.md`, import.meta.url), "utf8");
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model: ctx.model,
		thinkingLevel: ctx.thinkingLevel,
		tools: allowed[role],
		sessionManager: SessionManager.inMemory(),
	});
	const abort = () => {
		void session.abort();
	};
	signal?.addEventListener("abort", abort, { once: true });
	try {
		await session.prompt(`${prompt}\n\nAssignment:\n${task}`);
		await session.waitForIdle();
		const message = [...session.messages].reverse().find(item => item.role === "assistant");
		if (message?.stopReason !== "stop") throw new Error(`${role} did not finish successfully`);
		const text = message.content
			.filter(item => item.type === "text")
			.map(item => item.text)
			.join("\n")
			.trim();
		if (!text) throw new Error(`${role} returned no text`);
		return text;
	} finally {
		signal?.removeEventListener("abort", abort);
		session.dispose();
	}
}
