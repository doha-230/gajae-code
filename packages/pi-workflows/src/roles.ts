import * as fs from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Role } from "./state.ts";

const allowed: Record<Role, string[]> = {
	executor: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	planner: ["read", "grep", "find", "ls"],
	architect: ["read", "grep", "find", "ls"],
	critic: ["read", "grep", "find", "ls"],
};

function piInvocation(): { command: string; prefix: string[] } {
	const override = process.env.GJC_PI_CLI;
	if (override) {
		if (/\.(?:js|mjs|ts)$/i.test(override)) return { command: process.execPath, prefix: [override] };
		return { command: override, prefix: [] };
	}
	const entry = process.argv[1];
	if (entry && /(?:^|[\\/])cli\.(?:js|mjs|ts)$/i.test(entry)) return { command: process.execPath, prefix: [entry] };
	return { command: process.execPath, prefix: [] };
}

export async function runRole(
	role: Role,
	task: string,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<string> {
	if (!ctx.model) throw new Error("Select a Pi model before running a role");
	const prompt = await fs.readFile(new URL(`../agents/${role}.md`, import.meta.url), "utf8");
	const invocation = piInvocation();
	const thinking = pi.getThinkingLevel() === "max" ? "xhigh" : pi.getThinkingLevel();
	const args = [
		...invocation.prefix,
		"--print",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--tools",
		allowed[role].join(","),
		"--model",
		`${ctx.model.provider}/${ctx.model.id}`,
		"--thinking",
		thinking,
		`${prompt}\n\nAssignment:\n${task}`,
	];
	const result = await pi.exec(invocation.command, args, { cwd: ctx.cwd, signal, timeout: 900_000 });
	if (result.code !== 0 || result.killed)
		throw new Error(`${role} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
	const output = result.stdout.trim();
	if (!output) throw new Error(`${role} returned no text`);
	return output;
}
