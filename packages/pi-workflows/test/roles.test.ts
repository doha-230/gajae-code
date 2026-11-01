import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runRole } from "../src/roles.ts";

test("Pi role process inherits selected local model and restricts planning tools", async () => {
	let call: { command: string; args: string[]; cwd?: string } | undefined;
	const pi = {
		getThinkingLevel: () => "medium",
		exec: async (command: string, args: string[], options: { cwd?: string }) => {
			call = { command, args, cwd: options.cwd };
			return { stdout: "Plan ready\n", stderr: "", code: 0, killed: false };
		},
	} as unknown as ExtensionAPI;
	const ctx = { cwd: "/tmp/work", model: { provider: "local", id: "coder" } } as ExtensionContext;
	assert.equal(await runRole("planner", "Plan feature", pi, ctx), "Plan ready");
	assert.ok(call);
	assert.equal(call.cwd, "/tmp/work");
	assert.ok(call.args.includes("local/coder"));
	assert.ok(call.args.includes("read,grep,find,ls"));
	assert.ok(call.args.includes("--no-extensions"));
	assert.ok(!call.args.includes("edit"));
	assert.equal(await runRole("executor", "Implement feature", pi, ctx), "Plan ready");
	assert.ok(call);
	assert.ok(
		call.args.includes(
			process.platform === "win32" ? "read,grep,find,ls,powershell,edit,write" : "read,grep,find,ls,bash,edit,write",
		),
	);
});
