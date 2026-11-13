import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageSummary, parseReport, qualitySummary, securityText, testSummary } from "../src/server/ci/report-data.ts";

test("report formats are checked", () => {
  assert.ok(parseReport("tests", '{"cases":[{"name":"a","status":"passed","ms":1}]}'));
  assert.equal(parseReport("tests", '{"cases":[{"name":"a","status":"ok","ms":1}]}'), null);
  assert.equal(parseReport("tests", "not json"), null);
  assert.deepEqual(parseReport("coverage", '{"percent":81.25}'), { kind: "coverage", percent: 81.25 });
  assert.equal(parseReport("coverage", '{"percent":"high"}'), null);
  assert.ok(parseReport("quality", '[{"fingerprint":"f","severity":"minor","path":"a","line":1,"message":"m"}]'));
  assert.equal(parseReport("quality", '[{"fingerprint":"f"}]'), null);
  assert.ok(parseReport("security", '[{"id":"S1","severity":"high","title":"t","path":"a","line":1}]'));
  assert.equal(parseReport("security", '[{"id":"S1","severity":"severe","title":"t","path":"a","line":1}]'), null);
  assert.deepEqual(parseReport("security", "[]"), { kind: "security", items: [] });
});

test("test summary: a new failure is failed now and not failed in the base", () => {
  const head = [
    { name: "a", status: "failed", ms: 1 }, { name: "b", status: "failed", ms: 1 },
    { name: "c", status: "passed", ms: 1 }, { name: "d", status: "skipped", ms: 1 },
  ] as const;
  const base = [{ name: "b", status: "failed", ms: 1 }, { name: "a", status: "passed", ms: 1 }] as const;
  assert.deepEqual(testSummary(head, base), { text: "1 new failures, 2 failed, 1 passed, 1 skipped", new_failures: ["a"], failed: 2, passed: 1, skipped: 1 });
  assert.equal(testSummary(head, null).new_failures.length, 2);
  assert.deepEqual(testSummary(null, base), { text: "No test report.", new_failures: [], failed: 0, passed: 0, skipped: 0 });
});

test("coverage text always carries a sign", () => {
  assert.equal(coverageSummary(81.25, 82.75).text, "Coverage 81.25% (-1.50)");
  assert.equal(coverageSummary(82.75, 82.75).text, "Coverage 82.75% (+0.00)");
  assert.equal(coverageSummary(90, 82.5).text, "Coverage 90.00% (+7.50)");
  assert.equal(coverageSummary(81.25, null).text, "Coverage 81.25% (no base)");
  assert.equal(coverageSummary(null, 80).text, "Coverage unknown");
});

test("quality compares by fingerprint", () => {
  const item = (fingerprint: string) => ({ fingerprint, severity: "minor", path: "a", line: 1, message: "m" });
  assert.deepEqual(qualitySummary([item("f2"), item("f3")], [item("f1"), item("f2")]), { text: "1 new, 1 resolved", new: ["f3"], resolved: ["f1"] });
  assert.equal(qualitySummary(null, [item("f1")]).text, "No code quality report.");
});

test("security text counts the findings to review", () => {
  assert.equal(securityText(0), "No security findings need review.");
  assert.equal(securityText(1), "1 security finding needs review.");
  assert.equal(securityText(2), "2 security findings need review.");
});
