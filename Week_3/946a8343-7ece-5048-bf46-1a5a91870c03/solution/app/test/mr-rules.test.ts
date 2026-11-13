import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedAnnouncement, mayApprove, missingApprovals, ruleSignature, ruleViews, type RuleSpec } from "../src/server/mr/rules.ts";

function spec(name: string, kind: RuleSpec["kind"], required: number, eligible: string[], optional = false): RuleSpec {
  return { name, kind, required, optional, eligible: (username) => eligible.includes(username) };
}

const BACKEND = spec("Backend", "rule", 1, ["rev", "maint"]);
const OPS = spec("Ops", "rule", 1, ["rev", "dev"]);

test("one approval counts toward every rule its giver is eligible for", () => {
  const views = ruleViews([BACKEND, OPS], ["rev"], "dev");
  assert.deepEqual(views.map((view) => [view.name, view.given]), [["Backend", 1], ["Ops", 1]]);
});

test("the author never counts, though the approval is listed", () => {
  const views = ruleViews([BACKEND, OPS], ["dev"], "dev");
  assert.deepEqual(views.map((view) => view.given), [0, 0]);
});

test("missing approvals sum the shortfall in rule order and skip optional rules", () => {
  const rules = [spec("QA", "rule", 2, ["rev"]), spec("Docs", "owners", 1, ["maint"]), spec("Optional", "owners", 1, ["maint"], true)];
  assert.deepEqual(missingApprovals(ruleViews(rules, [], "dev")), { count: 3, names: ["QA", "Docs"] });
  assert.deepEqual(missingApprovals(ruleViews(rules, ["rev"], "dev")), { count: 2, names: ["QA", "Docs"] });
  assert.deepEqual(missingApprovals(ruleViews(rules, ["rev", "maint"], "dev")), { count: 1, names: ["QA"] });
});

test("eligibility: any rule, or anyone when no rule applies", () => {
  assert.equal(mayApprove([], "stranger"), true);
  assert.equal(mayApprove([BACKEND, OPS], "dev"), true);
  assert.equal(mayApprove([BACKEND], "dev"), false);
});

test("the announcement names what is still missing", () => {
  assert.equal(approvedAnnouncement({ count: 0, names: [] }), "Approved. All approval rules are satisfied.");
  assert.equal(approvedAnnouncement({ count: 1, names: ["Ops"] }), "Approved. Needs 1 more approval: Ops.");
  assert.equal(approvedAnnouncement({ count: 3, names: ["Ops", "QA"] }), "Approved. Needs 3 more approvals: Ops, QA.");
});

test("the rule signature ignores who approved", () => {
  const before = ruleSignature(ruleViews([BACKEND], [], "dev"));
  assert.equal(ruleSignature(ruleViews([BACKEND], ["rev"], "dev")), before);
  assert.notEqual(ruleSignature(ruleViews([BACKEND, OPS], [], "dev")), before);
});
