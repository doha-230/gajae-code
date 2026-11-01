import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { begin, canExecute, canHandoff, recordGoalRole, recordResearchReview, transition } from "../src/engine.ts";
import { measureJson } from "../src/research.ts";
import { digest, loadState, saveState, statePath } from "../src/state.ts";

test("interview specification needs clarified answer and exact approval", () => {
	let state = begin("session-1", "deep-interview", "Build feature");
	state = transition(state, { op: "answer", question: "Scope?", answer: "Maybe all", ambiguity: 3 });
	assert.throws(() => transition(state, { op: "crystallize", content: "Spec" }), /ambiguous/);
	state = transition(state, { op: "answer", question: "All modules?", answer: "Only CLI", ambiguity: 0 });
	state = transition(state, { op: "crystallize", content: "Only CLI" });
	assert.equal(state.status, "pending-approval");
	assert.equal(canExecute(state), false);
	assert.throws(() => transition(state, { op: "approve", hash: digest("other"), owner: state.owner }), /match/);
	state = transition(state, { op: "approve", hash: digest("Only CLI"), owner: state.owner });
	assert.equal(begin("session-1", "ralplan", "Build feature", state).mode, "ralplan");
});

test("ralplan requires same-pass consensus and current final hash", () => {
	let state = begin("session-1", "ralplan", "Build feature");
	state = transition(state, { op: "role", role: "planner", content: "draft" });
	assert.throws(() => transition(state, { op: "finalize", content: "final" }), /receipts/);
	state = transition(state, { op: "role", role: "architect", content: "needs change", verdict: "REVISE" });
	state = transition(state, { op: "role", role: "critic", content: "looks okay", verdict: "OKAY" });
	assert.throws(() => transition(state, { op: "finalize", content: "final" }), /consensus/);
	state = transition(state, { op: "revise" });
	assert.equal(state.plan?.pass, 2);
	state = transition(state, { op: "role", role: "planner", content: "fixed draft" });
	state = transition(state, { op: "role", role: "architect", content: "clear", verdict: "CLEAR" });
	state = transition(state, { op: "role", role: "critic", content: "okay", verdict: "OKAY" });
	state = transition(state, { op: "finalize", content: "final plan" });
	assert.equal(canHandoff(state), false);
	assert.throws(() => begin("session-1", "ultragoal", "Build feature", state), /Finish/);
	state = transition(state, { op: "approve", hash: digest("final plan"), owner: state.owner });
	assert.equal(canHandoff(state), true);
	assert.equal(begin("session-1", "ultragoal", "Build feature", state).approvedPlan?.content, "final plan");
	assert.equal(begin("session-1", "ultragoal", "Different task", state).task, "Build feature");
});

test("ralplan stops after five failed review passes", () => {
	let state = begin("session-1", "ralplan", "Build feature");
	for (let pass = 1; pass <= 5; pass++) {
		state = transition(state, { op: "role", role: "planner", content: `draft ${pass}` });
		state = transition(state, { op: "role", role: "architect", content: "revise", verdict: "REVISE" });
		state = transition(state, { op: "role", role: "critic", content: "revise", verdict: "REVISE" });
		state = transition(state, { op: "revise" });
	}
	assert.equal(state.status, "stuck");
	assert.equal(state.plan?.pass, 5);
	assert.equal(canHandoff(state), false);
});

test("ultragoal needs executor and matching passing critic receipt", () => {
	let state = begin("session-1", "ultragoal", "Build feature");
	state = transition(state, { op: "goals", descriptions: ["First"] });
	state = transition(state, { op: "start_goal", id: "g1" });
	assert.throws(
		() => transition(state, { op: "finish_goal", id: "g1", evidence: "test passed", critique: "PASS" }),
		/receipts/,
	);
	state = recordGoalRole(state, "executor", "Implemented and tested");
	state = recordGoalRole(state, "critic", "FAIL: missing edge case");
	assert.throws(
		() =>
			transition(state, {
				op: "finish_goal",
				id: "g1",
				evidence: "test passed",
				critique: "FAIL: missing edge case",
			}),
		/receipts/,
	);
	state = recordGoalRole(state, "critic", "PASS: edge case verified");
	state = transition(state, {
		op: "finish_goal",
		id: "g1",
		evidence: "test passed",
		critique: "PASS: edge case verified",
	});
	assert.equal(state.status, "complete");
});

test("research verdict requires evidence and state survives disk round trip", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "gjc-pi-workflows-"));
	try {
		let state = begin("session-1", "autoresearch", "Investigate");
		assert.throws(() => transition(state, { op: "evidence", content: "Source A" }), /intake/);
		state = transition(state, { op: "intake", mode: "web", constraints: [], deliverables: ["verdict"] });
		assert.throws(
			() => transition(state, { op: "verdict", status: "supported", conclusion: "yes", caveats: [] }),
			/evidence/,
		);
		state = transition(state, { op: "evidence", content: "Source A says yes" });
		assert.throws(
			() => transition(state, { op: "verdict", status: "supported", conclusion: "yes", caveats: [] }),
			/Critic/,
		);
		state = recordResearchReview(state, "Evidence supports a cautious yes");
		state = transition(state, {
			op: "verdict",
			status: "supported",
			conclusion: "Likely yes",
			caveats: ["One source"],
		});
		await saveState(cwd, state, "verdict");
		assert.deepEqual(await loadState(cwd, state.owner), state);
		const ledger = await readFile(path.join(path.dirname(statePath(cwd, state.owner)), "ledger.jsonl"), "utf8");
		assert.match(ledger, /"event":"verdict"/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("data research measures numeric records and rejects invalid values", () => {
	assert.deepEqual(measureJson([{ latency: 3 }, { latency: 1 }, { latency: 2 }], "latency"), {
		count: 3,
		min: 1,
		max: 3,
		mean: 2,
		median: 2,
		standardDeviation: Math.sqrt(2 / 3),
	});
	assert.throws(() => measureJson([{ latency: "3" }], "latency"), /finite numeric/);
});
