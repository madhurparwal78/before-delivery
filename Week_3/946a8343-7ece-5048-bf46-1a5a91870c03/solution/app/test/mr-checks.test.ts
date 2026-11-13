import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChecks, firstFailed, type CheckInput } from "../src/server/mr/checks.ts";

const HEALTHY: CheckInput = {
  closed: false,
  target: "main",
  targetExists: true,
  stackedOn: null,
  draft: false,
  conflicts: false,
  mergeMethod: "merge_commit",
  behindTarget: false,
  unresolvedThreads: 0,
  missingApprovals: 0,
  missingRuleNames: [],
  pipelinesMustSucceed: false,
  pipeline: null,
  sourceShort: "abcdef0",
  blockingFindings: 0,
};

function states(input: CheckInput): Record<string, string> {
  return Object.fromEntries(buildChecks(input).map((check) => [check.name, check.state]));
}

test("the ten checks come in the published order", () => {
  assert.deepEqual(
    buildChecks(HEALTHY).map((check) => check.name),
    ["state", "target", "stack", "draft", "conflicts", "rebase", "threads", "approvals", "pipeline", "security"],
  );
});

test("a healthy request passes what applies and leaves the rest inactive", () => {
  assert.deepEqual(states(HEALTHY), {
    state: "passed", target: "passed", stack: "passed", draft: "passed", conflicts: "passed",
    rebase: "inactive", threads: "passed", approvals: "passed", pipeline: "inactive", security: "inactive",
  });
  assert.equal(firstFailed(buildChecks(HEALTHY)), null);
});

test("failure texts are the published sentences", () => {
  const text = (input: CheckInput, name: string): string => buildChecks(input).find((check) => check.name === name)?.text ?? "";
  assert.equal(text({ ...HEALTHY, closed: true }, "state"), "This merge request is closed.");
  assert.equal(text({ ...HEALTHY, target: "rel", targetExists: false }, "target"), "Target branch rel no longer exists.");
  assert.equal(text({ ...HEALTHY, stackedOn: 3 }, "stack"), "Waiting for !3 to merge.");
  assert.equal(text({ ...HEALTHY, draft: true }, "draft"), "This merge request is a draft.");
  assert.equal(text({ ...HEALTHY, conflicts: true }, "conflicts"), "Source branch has conflicts with main.");
  assert.equal(text({ ...HEALTHY, mergeMethod: "fast_forward", behindTarget: true }, "rebase"), "Source branch must be rebased onto main.");
  assert.equal(text({ ...HEALTHY, unresolvedThreads: 1 }, "threads"), "1 unresolved thread must be resolved.");
  assert.equal(text({ ...HEALTHY, unresolvedThreads: 3 }, "threads"), "3 unresolved threads must be resolved.");
  assert.equal(text({ ...HEALTHY, missingApprovals: 1, missingRuleNames: ["QA"] }, "approvals"), "Needs 1 more approval: QA.");
  assert.equal(text({ ...HEALTHY, missingApprovals: 3, missingRuleNames: ["QA", "Docs"] }, "approvals"), "Needs 3 more approvals: QA, Docs.");
  assert.equal(text({ ...HEALTHY, blockingFindings: 1 }, "security"), "1 security finding needs review.");
  assert.equal(text({ ...HEALTHY, blockingFindings: 2 }, "security"), "2 security findings need review.");
});

test("the rebase check applies only to fast-forward and rebase merges", () => {
  assert.equal(states({ ...HEALTHY, behindTarget: true }).rebase, "inactive");
  assert.equal(states({ ...HEALTHY, mergeMethod: "rebase", behindTarget: true }).rebase, "failed");
  assert.equal(states({ ...HEALTHY, mergeMethod: "rebase" }).rebase, "passed");
  assert.equal(states({ ...HEALTHY, mergeMethod: "squash", behindTarget: true }).rebase, "inactive");
});

test("the pipeline check applies only when pipelines must succeed", () => {
  const strict = { ...HEALTHY, pipelinesMustSucceed: true };
  assert.equal(states({ ...HEALTHY, pipeline: { id: 4, status: "failed" } }).pipeline, "inactive");
  const none = buildChecks(strict).find((check) => check.name === "pipeline");
  assert.deepEqual([none?.state, none?.text], ["failed", "Pipeline must succeed. No pipeline has run on abcdef0."]);
  const failed = buildChecks({ ...strict, pipeline: { id: 9, status: "failed" } }).find((check) => check.name === "pipeline");
  assert.deepEqual([failed?.state, failed?.text], ["failed", "Pipeline must succeed. Latest pipeline 9 is failed."]);
  assert.equal(states({ ...strict, pipeline: { id: 9, status: "success" } }).pipeline, "passed");
});

test("passed and inactive checks carry no failure text", () => {
  assert.ok(buildChecks(HEALTHY).every((check) => check.text === ""));
});

test("the first failed check wins, and ignored names are skipped", () => {
  const checks = buildChecks({ ...HEALTHY, draft: true, unresolvedThreads: 2, pipelinesMustSucceed: true });
  assert.equal(firstFailed(checks)?.name, "draft");
  assert.equal(firstFailed(checks, ["draft"])?.name, "threads");
  assert.equal(firstFailed(checks, ["draft", "threads", "pipeline"]), null);
});
