---
name: ralplan
description: Reach a reviewed consensus plan with Planner, Architect and Critic, then obtain artifact-specific approval
---

# Ralplan

Start with `/gjc-ralplan <task>`. Direct `/skill:ralplan` resumes a seeded run in the same Pi session. The plan is planning only until `/gjc-approve` confirms the final artifact.

1. Read `gjc_workflow` status and any approved interview specification. Resolve material user intent ambiguity before role dispatch.
2. Call `gjc_role` as `planner` once for the initial pass. It runs an isolated Pi session with read-only tools. The tool records the full draft and hash. Use the returned revision for the next call.
3. Call `gjc_role` as `architect` with the current draft; then `critic` with both draft and architect findings. Pass 1 may be reviewed independently, but sequential calls are safe. Later passes must run Architect then Critic. Both are read-only isolated sessions.
4. Consensus requires Architect `CLEAR` or `APPROVE` and Critic `OKAY` on the same pass. If either asks for revision, call `gjc_workflow` with `{"op":"revise"}`. Then run Planner, Architect, Critic again. At pass 5 a further revision marks the run `stuck`; stop and report the unresolved issues. Do not execute.
5. Reconcile new assumptions or conflicts with the user after reviews. If the answers alter the plan, revise and review again within the same five-pass budget. The final Markdown must include the decision, drivers, alternatives, steps, tests, risks, and intent reconciliation.
6. On consensus, call `gjc_workflow` with `{"op":"finalize","content":"<final plan>"}`. The extension writes `pending-approval.md` and records its SHA-256. Present its path and hash. The user may use `/gjc-approve` after review; only its UI confirmation admits an Ultragoal handoff.
7. Once approved, the user can run `/gjc-ultragoal <task>` in the same Pi session. The command carries the exact approved plan and hash into the execution state. Do not start execution yourself before the user issues that command.

Use `gjc_workflow` with an action JSON string and `expectedRevision` for each mutation. Re-read status after a stale revision error. No project source mutation, shell execution, commit, push, or PR before approval. The extension blocks mutating tools while planning.
