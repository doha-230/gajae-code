---
name: autoresearch
description: Investigate a question with evidence and a verdict without implementing product changes
---

# Autoresearch

Start with `/gjc-autoresearch <question>`. Direct `/skill:autoresearch` resumes a seeded run only. This workflow produces findings and a verdict; it does not implement changes.

1. Read `gjc_workflow` status and clarify objective, constraints, and deliverables with the user before searching. Record `{"op":"intake","mode":"web|data|hybrid","constraints":["..."],"deliverables":["..."]}`. Use read-only repository tools, `gjc_research_fetch` for bounded HTTP(S) text sources, and `gjc_research_measure` for descriptive statistics on local JSON data. Run `planner` or `architect` through `gjc_role` when independent analysis helps; each uses an isolated read-only Pi session and the currently selected model, including a configured local LLM.
2. For each source or experiment, call `gjc_workflow` with `{"op":"evidence","content":"<source, method, finding, uncertainty>"}` and the current revision. Record contradictory findings, failed checks, and confidence limits. State is persisted in `.gjc/pi-workflows/<Pi session>/`.
3. Call `gjc_role` as `critic` to review the full evidence and challenge unsupported claims. The review is persisted as a role receipt.
4. Call `gjc_workflow` with `{"op":"verdict","status":"supported|refuted|inconclusive","conclusion":"...","caveats":["..."]}`. This closes the research run with an evaluator identity. Report the verdict, evidence, and caveats to the user.

No source edits, shell mutation, commits, or implementation handoff occur in this workflow. The extension blocks mutating tools while research is active. If the user wants implementation, start a new explicitly requested planning or execution workflow.
