# GJC workflows for Pi

This local Pi package adds the four GJC role agents (`executor`, `architect`, `planner`, `critic`) and four workflow skills (`deep-interview`, `ralplan`, `ultragoal`, `autoresearch`) to an existing Pi Coding Agent installation. It is an extension and skill package, not a separate executable. Each role runs through the currently installed Pi CLI in an isolated, restricted process using the model selected in Pi, including a local OpenAI-compatible model.

## Install into an existing Pi

From the Gajae-Code checkout:

```sh
pi install ./packages/pi-workflows
pi list
```

Pi stores the package path in its user settings. Start Pi from the project where you want the workflow state. Windows PowerShell uses the same `pi install .\packages\pi-workflows` command from the checkout.

For an isolated profile, set `PI_CODING_AGENT_DIR` before installing and starting Pi:

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi/gjc-profile"
pi install ./packages/pi-workflows
pi
```

```powershell
$env:PI_CODING_AGENT_DIR = "$HOME\.pi\gjc-profile"
pi install .\packages\pi-workflows
pi
```

The same package works on Linux and Windows with a Pi release that supports the host platform. It loads with both `@mariozechner/pi-coding-agent` 0.73.1 and its successor `@earendil-works/pi-coding-agent` 1.4.0. The extension uses Node file APIs and Pi's built-in tools; it does not require Bun or the GJC compiled binary at runtime. The role runner uses the active Pi CLI entry point; `GJC_PI_CLI` can override it when embedding Pi through an SDK host.

## Local model

Configure your Pi profile's `models.json` with a provider that exposes an OpenAI-compatible endpoint. For example, with Ollama:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "qwen2.5-coder:7b" }]
    }
  }
}
```

Choose that model in Pi using `/model` before starting a GJC workflow. All four role agents inherit the current Pi model and thinking level. Model quality and tool-call support determine how reliably the agent follows each skill.

## Commands

| Command | Effect |
| --- | --- |
| `/gjc-deep-interview <task>` | Start interview and specification workflow |
| `/gjc-ralplan <task>` | Start reviewed consensus planning |
| `/gjc-ultragoal <task>` | Start goal-tracked execution; carries an approved plan if present |
| `/gjc-autoresearch <question>` | Start evidence and verdict research |
| `/gjc-status` | Show current run status and revision |
| `/gjc-approve` | Confirm the current exact specification or plan through Pi UI |
| `/gjc-pause`, `/gjc-resume` | Control an active run |

The package also registers `gjc_workflow`, `gjc_role`, bounded `gjc_research_fetch`, and JSON `gjc_research_measure` tools. Skills instruct Pi how to call them. Use the commands to start runs; invoking `/skill:<name>` directly is for resuming an already seeded run.

Workflow state, artifacts, and an append-only transition ledger live at `.gjc/pi-workflows/<Pi session ID>/`. Ralplan writes `pending-approval.md`; Deep Interview writes `specification.md`. `/gjc-approve` checks the on-disk artifact against its recorded SHA-256 before and after confirmation. A changed plan needs a new approval. Planning and research block mutating Pi tools. Ultragoal records per-goal Executor and Critic receipts and requires verification evidence before completion.

If you use a headless Pi client, it must support Pi's UI confirmation requests to approve a plan. Otherwise the run remains pending approval. Starting Ultragoal directly with `/gjc-ultragoal` is an explicit user execution request; it does not bypass a pending Ralplan artifact in the same session.
