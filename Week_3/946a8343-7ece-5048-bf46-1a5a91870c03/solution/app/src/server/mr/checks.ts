// The ten merge checks, in the published order, with their exact texts (see "Merge checks and auto-merge").
import { conflict } from "../errors.ts";
import type { MergeMethod } from "../../shared/settings.ts";

type CheckState = "passed" | "failed" | "inactive";

export interface CheckInput {
  readonly closed: boolean;
  readonly target: string;
  readonly targetExists: boolean;
  /** iid of the open request whose source branch is this request's target, if any. */
  readonly stackedOn: number | null;
  readonly draft: boolean;
  readonly conflicts: boolean;
  readonly mergeMethod: MergeMethod;
  /** The target head is not an ancestor of the source head. */
  readonly behindTarget: boolean;
  readonly unresolvedThreads: number;
  readonly missingApprovals: number;
  readonly missingRuleNames: readonly string[];
  readonly pipelinesMustSucceed: boolean;
  readonly pipeline: { readonly id: number; readonly status: string } | null;
  readonly sourceShort: string;
  readonly blockingFindings: number;
}

const PIPELINE_OK: ReadonlySet<string> = new Set(["success", "warning"]);

function approvalsNeedText(count: number, names: readonly string[]): string {
  return `Needs ${count} more ${count === 1 ? "approval" : "approvals"}: ${names.join(", ")}.`;
}

// The texts that the speculative merges of a train and the rebase route repeat for their own refusals.
export const targetGoneText = (target: string): string => `Target branch ${target} no longer exists.`;
export const conflictsText = (target: string): string => `Source branch has conflicts with ${target}.`;

interface Verdict {
  readonly state: CheckState;
  readonly text: string;
}

const INACTIVE: Verdict = { state: "inactive", text: "" };

function failedWhen(failed: boolean, text: string): Verdict {
  return failed ? { state: "failed", text } : { state: "passed", text: "" };
}

interface CheckRule {
  readonly name: string;
  readonly evaluate: (input: CheckInput) => Verdict;
}

// The one place that lists the checks and decides their order.
const CHECKS = [
  { name: "state", evaluate: (input) => failedWhen(input.closed, "This merge request is closed.") },
  { name: "target", evaluate: (input) => failedWhen(!input.targetExists, targetGoneText(input.target)) },
  { name: "stack", evaluate: (input) => failedWhen(input.stackedOn !== null, `Waiting for !${input.stackedOn ?? 0} to merge.`) },
  { name: "draft", evaluate: (input) => failedWhen(input.draft, "This merge request is a draft.") },
  { name: "conflicts", evaluate: (input) => failedWhen(input.conflicts, conflictsText(input.target)) },
  {
    name: "rebase",
    evaluate: (input) => input.mergeMethod === "fast_forward" || input.mergeMethod === "rebase"
      ? failedWhen(input.behindTarget, `Source branch must be rebased onto ${input.target}.`)
      : INACTIVE,
  },
  {
    name: "threads",
    evaluate: (input) => failedWhen(
      input.unresolvedThreads > 0,
      input.unresolvedThreads === 1 ? "1 unresolved thread must be resolved." : `${input.unresolvedThreads} unresolved threads must be resolved.`,
    ),
  },
  {
    name: "approvals",
    evaluate: (input) => failedWhen(input.missingApprovals > 0, approvalsNeedText(input.missingApprovals, input.missingRuleNames)),
  },
  {
    name: "pipeline",
    evaluate: (input) => !input.pipelinesMustSucceed
      ? INACTIVE
      : failedWhen(
        input.pipeline === null || !PIPELINE_OK.has(input.pipeline.status),
        input.pipeline === null
          ? `Pipeline must succeed. No pipeline has run on ${input.sourceShort}.`
          : `Pipeline must succeed. Latest pipeline ${input.pipeline.id} is ${input.pipeline.status}.`,
      ),
  },
  {
    name: "security",
    evaluate: (input) => input.blockingFindings > 0
      ? failedWhen(true, input.blockingFindings === 1 ? "1 security finding needs review." : `${input.blockingFindings} security findings need review.`)
      : INACTIVE,
  },
] as const satisfies readonly CheckRule[];

type CheckName = (typeof CHECKS)[number]["name"];

export interface CheckResult extends Verdict {
  readonly name: CheckName;
}

export function buildChecks(input: CheckInput): CheckResult[] {
  return CHECKS.map((check) => ({ name: check.name, ...check.evaluate(input) }));
}

export function firstFailed(checks: readonly CheckResult[], ignore: readonly string[] = []): CheckResult | null {
  return checks.find((check) => check.state === "failed" && !ignore.includes(check.name)) ?? null;
}

/** 409 `merge_blocked` with the text of the first failed check (those named in `ignore` do not count). */
export function assertNotBlocked(checks: readonly CheckResult[], ignore: readonly string[] = []): void {
  const failed = firstFailed(checks, ignore);
  if (failed !== null) throw conflict("merge_blocked", failed.text);
}
