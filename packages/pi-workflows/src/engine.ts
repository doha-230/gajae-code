import { digest, type Mode, newState, type Receipt, type Role, type WorkflowState } from "./state.ts";

export type Action =
	| { op: "answer"; question: string; answer: string; ambiguity: number }
	| { op: "crystallize"; content: string }
	| { op: "role"; role: Role; content: string; verdict?: string }
	| { op: "revise" }
	| { op: "finalize"; content: string }
	| { op: "approve"; hash: string; owner: string }
	| { op: "goals"; descriptions: string[] }
	| { op: "start_goal"; id: string }
	| { op: "finish_goal"; id: string; evidence: string; critique: string }
	| { op: "block_goal"; id: string; reason: string }
	| { op: "intake"; mode: "web" | "data" | "hybrid"; constraints: string[]; deliverables: string[] }
	| { op: "evidence"; content: string }
	| { op: "verdict"; status: "supported" | "refuted" | "inconclusive"; conclusion: string; caveats: string[] }
	| { op: "pause" }
	| { op: "resume" };

function requireActive(state: WorkflowState, mode: Mode): void {
	if (state.mode !== mode || state.status !== "active") throw new Error(`${mode} must be active`);
}
function requireText(value: string, label: string): void {
	if (!value.trim()) throw new Error(`${label} is required`);
}
function receipt(role: Role, content: string, verdict?: string): Receipt {
	requireText(content, `${role} result`);
	return { role, content, ...(verdict ? { verdict } : {}), hash: digest(content), at: new Date().toISOString() };
}
export function begin(owner: string, mode: Mode, task: string, previous?: WorkflowState): WorkflowState {
	requireText(task, "task");
	if (
		previous &&
		!["complete", "stuck"].includes(previous.status) &&
		!(mode === "ultragoal" && canHandoff(previous)) &&
		!(mode === "ralplan" && previous.mode === "deep-interview" && previous.status === "approved")
	)
		throw new Error("Finish or stop the current workflow before starting another");
	const next = newState(owner, mode, mode === "ultragoal" && canHandoff(previous) ? previous!.task : task);
	if (mode === "ultragoal" && canHandoff(previous))
		next.approvedPlan = { content: previous!.plan!.final!, hash: previous!.plan!.hash!, sourceRun: previous!.id };
	return next;
}
export function transition(state: WorkflowState, action: Action): WorkflowState {
	const next: WorkflowState = structuredClone(state);
	switch (action.op) {
		case "answer": {
			requireActive(next, "deep-interview");
			if (!Number.isInteger(action.ambiguity) || action.ambiguity < 0 || action.ambiguity > 5)
				throw new Error("Ambiguity must be an integer from 0 to 5");
			requireText(action.question, "question");
			requireText(action.answer, "answer");
			next.interview!.round++;
			next.interview!.answers.push({
				question: action.question,
				answer: action.answer,
				ambiguity: action.ambiguity,
			});
			break;
		}
		case "crystallize": {
			requireActive(next, "deep-interview");
			if (!next.interview!.answers.length) throw new Error("Interview needs an answer");
			if (next.interview!.answers.at(-1)!.ambiguity > 1)
				throw new Error("Resolve the latest ambiguous answer first");
			requireText(action.content, "specification");
			next.interview!.specification = action.content;
			next.interview!.hash = digest(action.content);
			next.status = "pending-approval";
			break;
		}
		case "role": {
			if (next.mode !== "ralplan") throw new Error("Plan role receipts belong to ralplan");
			requireActive(next, "ralplan");
			const plan = next.plan!;
			const item = receipt(action.role, action.content, action.verdict);
			if (action.role === "planner") {
				if (plan.draft) throw new Error("Planner draft already exists for this pass");
				plan.draft = item;
			} else if (action.role === "architect") {
				if (!plan.draft || plan.architect) throw new Error("Architect needs a new planner draft");
				plan.architect = item;
			} else if (action.role === "critic") {
				if (!plan.architect || plan.critic) throw new Error("Critic needs the current architect review");
				plan.critic = item;
			} else throw new Error("Executor cannot write a planning receipt");
			plan.history.push(item);
			break;
		}
		case "revise": {
			requireActive(next, "ralplan");
			const plan = next.plan!;
			if (!plan.critic) throw new Error("Complete both reviews before revision");
			if (plan.pass >= 5) {
				next.status = "stuck";
				break;
			}
			plan.pass++;
			delete plan.draft;
			delete plan.architect;
			delete plan.critic;
			break;
		}
		case "finalize": {
			requireActive(next, "ralplan");
			const plan = next.plan!;
			if (!plan.draft || !plan.architect || !plan.critic)
				throw new Error("Planner, architect, and critic receipts required");
			if (!/^(CLEAR|APPROVE)$/i.test(plan.architect.verdict ?? "") || !/^OKAY$/i.test(plan.critic.verdict ?? ""))
				throw new Error("Reviews have not reached consensus");
			requireText(action.content, "final plan");
			plan.final = action.content;
			plan.hash = digest(action.content);
			delete plan.approval;
			next.status = "pending-approval";
			break;
		}
		case "approve": {
			if (next.status !== "pending-approval" || !["ralplan", "deep-interview"].includes(next.mode))
				throw new Error("No pending artifact");
			const hash = next.mode === "ralplan" ? next.plan!.hash : next.interview!.hash;
			if (!hash || action.hash !== hash || action.owner !== next.owner)
				throw new Error("Approval does not match current artifact and owner");
			if (next.mode === "ralplan") next.plan!.approval = { hash, owner: action.owner, at: new Date().toISOString() };
			next.status = "approved";
			break;
		}
		case "goals": {
			requireActive(next, "ultragoal");
			if (next.goals!.length || !action.descriptions.length) throw new Error("Goals already exist or none supplied");
			if (action.descriptions.some(item => !item.trim())) throw new Error("Every goal needs a description");
			next.goals = action.descriptions.map((description, index) => ({
				id: `g${index + 1}`,
				description,
				status: "pending",
			}));
			break;
		}
		case "start_goal": {
			requireActive(next, "ultragoal");
			if (next.goals!.some(goal => goal.status === "active")) throw new Error("Finish current goal first");
			const goal = next.goals!.find(item => item.id === action.id);
			if (goal?.status !== "pending") throw new Error("Goal is not pending");
			goal.status = "active";
			break;
		}
		case "finish_goal": {
			requireActive(next, "ultragoal");
			const goal = next.goals!.find(item => item.id === action.id);
			if (goal?.status !== "active") throw new Error("Goal is not active");
			requireText(action.evidence, "verification evidence");
			requireText(action.critique, "critic review");
			if (
				!goal.executor ||
				!goal.critic ||
				goal.critic.hash !== digest(action.critique) ||
				!/^PASS\b/i.test(goal.critic.content.trim())
			)
				throw new Error("Executor and passing Critic role receipts required");
			goal.status = "complete";
			goal.evidence = action.evidence;
			goal.critique = action.critique;
			if (next.goals!.every(item => item.status === "complete")) next.status = "complete";
			break;
		}
		case "block_goal": {
			requireActive(next, "ultragoal");
			const goal = next.goals!.find(item => item.id === action.id);
			if (goal?.status !== "active") throw new Error("Goal is not active");
			requireText(action.reason, "block reason");
			goal.status = "blocked";
			goal.evidence = action.reason;
			next.status = "blocked";
			break;
		}
		case "intake": {
			requireActive(next, "autoresearch");
			if (next.research!.mode) throw new Error("Research intake already recorded");
			if (
				!["web", "data", "hybrid"].includes(action.mode) ||
				!Array.isArray(action.constraints) ||
				!Array.isArray(action.deliverables) ||
				!action.deliverables.length
			)
				throw new Error("Research intake needs mode, constraints, and deliverables");
			next.research!.mode = action.mode;
			next.research!.constraints = action.constraints;
			next.research!.deliverables = action.deliverables;
			break;
		}
		case "evidence": {
			requireActive(next, "autoresearch");
			if (!next.research!.mode) throw new Error("Research intake required before evidence");
			requireText(action.content, "evidence");
			next.research!.evidence.push(action.content);
			break;
		}
		case "verdict": {
			requireActive(next, "autoresearch");
			if (!next.research!.evidence.length) throw new Error("Research needs evidence");
			if (
				!next.research!.review ||
				next.research!.reviewedEvidenceHash !== digest(JSON.stringify(next.research!.evidence))
			)
				throw new Error("Critic review of current evidence required before verdict");
			if (!["supported", "refuted", "inconclusive"].includes(action.status) || !Array.isArray(action.caveats))
				throw new Error("Structured verdict status and caveats required");
			requireText(action.conclusion, "verdict conclusion");
			next.research!.verdict = {
				status: action.status,
				conclusion: action.conclusion,
				caveats: action.caveats,
				evaluator: "critic",
			};
			next.status = "complete";
			break;
		}
		case "pause": {
			if (next.status !== "active") throw new Error("Only active workflows can pause");
			next.status = "paused";
			break;
		}
		case "resume": {
			if (!["paused", "blocked"].includes(next.status))
				throw new Error("Only paused or blocked workflows can resume");
			if (next.mode === "ultragoal")
				for (const goal of next.goals ?? []) if (goal.status === "blocked") goal.status = "pending";
			next.status = "active";
			break;
		}
		default:
			throw new Error("Unknown workflow action");
	}
	next.revision++;
	return next;
}

export function recordGoalRole(state: WorkflowState, role: "executor" | "critic", content: string): WorkflowState {
	requireActive(state, "ultragoal");
	const next = structuredClone(state);
	const goal = next.goals?.find(item => item.status === "active");
	if (!goal) throw new Error("Start a goal before running an execution role");
	if (role === "critic" && !goal.executor) throw new Error("Executor receipt required before Critic");
	goal[role] = receipt(role, content);
	next.revision++;
	return next;
}

export function recordResearchReview(state: WorkflowState, content: string): WorkflowState {
	requireActive(state, "autoresearch");
	if (!state.research?.evidence.length) throw new Error("Evidence required before Critic review");
	const next = structuredClone(state);
	next.research!.review = receipt("critic", content);
	next.research!.reviewedEvidenceHash = digest(JSON.stringify(next.research!.evidence));
	next.revision++;
	return next;
}

export function canExecute(state: WorkflowState | undefined): boolean {
	return (
		!state ||
		state.status === "complete" ||
		state.status === "stuck" ||
		(state.mode === "ultragoal" && state.status === "active")
	);
}
export function canHandoff(plan: WorkflowState | undefined): boolean {
	return (
		!!plan &&
		plan.mode === "ralplan" &&
		plan.status === "approved" &&
		!!plan.plan?.approval &&
		plan.plan.approval.hash === plan.plan.hash
	);
}
