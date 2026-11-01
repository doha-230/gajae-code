---
name: ultragoal
description: Execute an approved plan as goal-tracked work with Executor and Critic quality gates
---

# Ultragoal

Start with `/gjc-ultragoal <task>`. This is an explicit user execution request. When it follows an approved Ralplan in the same Pi session, the extension carries the approved plan and hash into this run. Direct `/skill:ultragoal` resumes a seeded run only.

1. Read `gjc_workflow` status, including `approvedPlan` when present. Translate the task and plan into finite, verifiable goals. Call `gjc_workflow` with `{"op":"goals","descriptions":["...", "..."]}`. The engine stores them under `.gjc/pi-workflows/<Pi session>/state.json` and appends every transition to `ledger.jsonl`.
2. Select the next pending goal and call `{"op":"start_goal","id":"g1"}`. Only one goal may be active at once. Send a focused assignment to `gjc_role` with `role:"executor"`; it uses the current Pi model and the Pi coding tools. The result becomes a durable Executor receipt.
3. Run relevant verification on the changed work and collect concrete evidence: commands, exit status, tests, artifact paths, and limits. Then call `gjc_role` as `critic` to independently check the goal and evidence using read-only tools. It must start its answer with `PASS` or `FAIL`.
4. On `PASS`, call `gjc_workflow` with `{"op":"finish_goal","id":"g1","evidence":"...","critique":"<exact Critic output>"}`. The engine checks that the critique matches the recorded Critic receipt. A failed Critic review requires Executor correction and another review. A hard blocker uses `{"op":"block_goal","id":"g1","reason":"..."}` and stops dispatch.
5. Continue until all goals are complete. The final response must name the changed files, verification evidence, and remaining limits. The ledger and goal statuses support resumption after interruption. The user can use `/gjc-pause` and `/gjc-resume` to control the run.

Do not mark a goal complete from an unverified claim. Do not begin a new workflow while an Ultragoal run remains active. Follow repository approval and commit rules.
