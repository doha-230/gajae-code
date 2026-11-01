---
name: deep-interview
description: Clarify requirements through rounds of questions and produce an approved specification before planning
---

# Deep interview

Start with `/gjc-deep-interview <task>`. This command seeds durable state under `.gjc/pi-workflows/<Pi session>/` and expands this skill. Direct `/skill:deep-interview` is only for resuming a run already seeded in this Pi session.

1. Call `gjc_workflow` with `{"op":"status"}` to read the current state and revision. Ask the user one decision at a time. Round 0 covers objective, success criteria, constraints, non-goals, and unknowns. Avoid repeating settled questions.
2. After each actual user answer, call `gjc_workflow` with `{"op":"answer","question":"...","answer":"...","ambiguity":0..5}` and `expectedRevision` from the latest state. Score 0 when explicit and testable, 1 when a minor inference remains, 2–5 for increasing uncertainty. If the last answer scores above 1, ask a follow-up and record the clarified answer before crystallizing.
3. Draft a Markdown specification with user intent, acceptance criteria, constraints, decisions, unresolved items, and non-goals. Call `gjc_workflow` with `{"op":"crystallize","content":"<full specification>"}`. The tool writes `specification.md` and marks it pending approval.
4. Give the user the artifact path and current hash. Ask them to inspect it and use `/gjc-approve` if correct. Only that command's UI confirmation can approve the exact hash. A direct statement, role output, or skill invocation is not approval.
5. After approval, the user may start `/gjc-ralplan <task>`. Interviewing never edits project source or starts implementation.

During this workflow use only `read`, `grep`, `find`, `ls`, and GJC tools. No shell, source writes, commits, or implementation delegation. The extension blocks mutating tools while the workflow is active.
