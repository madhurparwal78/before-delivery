import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, metricsWindow, startOfLocalDay, type DeploymentFact } from "../src/server/ci/metrics.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fact = (number: number, status: string, finishedAt: number, leadTimesMs: number[] = []): DeploymentFact => ({ environmentId: 1, number, status, finishedAt, leadTimesMs });

test("days are cut at local midnight", () => {
  const noon = Date.UTC(2026, 0, 10, 12);
  assert.equal(startOfLocalDay({ year: 2026, month: 1, day: 10 }, "UTC"), Date.UTC(2026, 0, 10));
  assert.equal(startOfLocalDay({ year: 2026, month: 1, day: 10 }, "Asia/Tokyo"), Date.UTC(2026, 0, 9, 15));
  assert.deepEqual(metricsWindow(noon, "UTC", 7), { start: Date.UTC(2026, 0, 4), end: Date.UTC(2026, 0, 11) });
  assert.equal(metricsWindow(Date.UTC(2026, 0, 10, 20), "Asia/Tokyo", 1).start, Date.UTC(2026, 0, 10, 15));
});

test("frequency, change failure rate and recovery follow the brief", () => {
  const start = Date.UTC(2026, 0, 2, 23);
  const facts = [fact(1, "success", start), fact(2, "failed", start + HOUR), fact(3, "success", start + 3 * HOUR)];
  const metrics = computeMetrics(facts, start + 3 * HOUR, "UTC", 7);
  assert.deepEqual(metrics, { deployment_frequency: 0.29, lead_time_hours: null, change_failure_rate: 50, recovery_time_hours: 2 });
});

test("a deployment that was rolled back counts as a failed change", () => {
  const at = Date.UTC(2026, 0, 5, 10);
  const facts = [fact(1, "rolled_back", at), fact(2, "success", at + HOUR), fact(3, "success", at + 2 * HOUR)];
  assert.equal(computeMetrics(facts, at + DAY, "UTC", 7).change_failure_rate, 33.3);
});

test("a window of one zone can hold what another zone's window does not", () => {
  const first = Date.UTC(2026, 0, 2, 23);
  const facts = [fact(1, "success", first), fact(2, "success", first + 27 * HOUR)];
  const now = Date.UTC(2026, 0, 9, 1);
  assert.equal(computeMetrics(facts, now, "UTC", 7).deployment_frequency, 0.14);
  assert.equal(computeMetrics(facts, now, "Asia/Tokyo", 7).deployment_frequency, 0.29);
});

test("lead time is the lower middle of the request lead times", () => {
  const at = Date.UTC(2026, 0, 5, 10);
  const facts = [fact(1, "success", at, [4 * HOUR, 1 * HOUR]), fact(2, "success", at + HOUR, [2 * HOUR, 8 * HOUR])];
  assert.equal(computeMetrics(facts, at + DAY, "UTC", 7).lead_time_hours, 2);
});

test("no deployments gives no rates", () => {
  assert.deepEqual(computeMetrics([], Date.UTC(2026, 0, 5), "UTC", 30), { deployment_frequency: 0, lead_time_hours: null, change_failure_rate: null, recovery_time_hours: null });
});
