// Approval rules of a request: project rules, owners sections and the security rule, with who counts toward which.

type RuleKind = "rule" | "owners" | "security";

export interface RuleSpec {
  readonly name: string;
  readonly kind: RuleKind;
  readonly required: number;
  readonly optional: boolean;
  /** Whether an approval by this username counts toward the rule. */
  readonly eligible: (username: string) => boolean;
}

export interface RuleView {
  readonly name: string;
  readonly kind: RuleKind;
  readonly required: number;
  readonly given: number;
  readonly optional: boolean;
}

/** Every approval counts toward every rule its giver is eligible for; the author never counts. */
export function ruleViews(specs: readonly RuleSpec[], approvedBy: readonly string[], author: string): RuleView[] {
  const counting = approvedBy.filter((username) => username !== author);
  return specs.map((spec) => ({
    name: spec.name,
    kind: spec.kind,
    required: spec.required,
    given: counting.filter((username) => spec.eligible(username)).length,
    optional: spec.optional,
  }));
}

interface Missing {
  readonly count: number;
  readonly names: readonly string[];
}

/** Optional rules need nothing; the others each miss `required - given` approvals. */
export function missingApprovals(views: readonly RuleView[]): Missing {
  let count = 0;
  const names: string[] = [];
  for (const view of views) {
    if (view.optional) continue;
    const short = view.required - view.given;
    if (short <= 0) continue;
    count += short;
    names.push(view.name);
  }
  return { count, names };
}

/** Anyone eligible for at least one rule may approve; with no rule any developer may. */
export function mayApprove(specs: readonly RuleSpec[], username: string): boolean {
  return specs.length === 0 || specs.some((spec) => spec.eligible(username));
}

export function approvedAnnouncement(missing: Missing): string {
  if (missing.count === 0) return "Approved. All approval rules are satisfied.";
  return `Approved. Needs ${missing.count} more ${missing.count === 1 ? "approval" : "approvals"}: ${missing.names.join(", ")}.`;
}

/** What identifies the rule list apart from who has approved it: a change means the approvals panel must refresh. */
export function ruleSignature(views: readonly RuleView[]): string {
  return JSON.stringify(views.map((view) => [view.name, view.kind, view.required, view.optional]));
}
