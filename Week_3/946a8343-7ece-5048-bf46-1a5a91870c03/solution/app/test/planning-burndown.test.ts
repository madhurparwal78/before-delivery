import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, burndown, dayStart, daysBetween, isDate, localDate, type HistoryEvent } from "../src/server/planning/burndown.ts";

const at = (iso: string): number => Date.parse(iso);

test("dates are real calendar days", () => {
  assert.ok(isDate("2026-02-28") && isDate("2028-02-29"));
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-01", "", "x"]) assert.ok(!isDate(bad), bad);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.deepEqual(daysBetween("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(daysBetween("2026-03-02", "2026-03-01"), []);
});

test("days begin at local midnight of the zone", () => {
  assert.equal(dayStart("2026-01-05", "UTC"), at("2026-01-05T00:00:00Z"));
  assert.equal(dayStart("2026-01-05", "Asia/Tokyo"), at("2026-01-04T15:00:00Z"));
  assert.equal(dayStart("2026-07-01", "America/New_York"), at("2026-07-01T04:00:00Z"));
  assert.equal(localDate(at("2026-01-04T15:00:00Z"), "Asia/Tokyo"), "2026-01-05");
  assert.equal(localDate(at("2026-01-04T14:59:59Z"), "Asia/Tokyo"), "2026-01-04");
});

function events(...list: [string, number | null, "opened" | "closed"][]): HistoryEvent[] {
  return list.map(([when, weight, state]) => ({ at: at(when), weight, state }));
}

test("remaining sums the weights at the end of each day of the issues open then", () => {
  const histories = new Map<number, HistoryEvent[]>([
    [1, events(["2026-02-02T09:00:00Z", 3, "opened"], ["2026-02-03T10:00:00Z", 5, "opened"], ["2026-02-04T08:00:00Z", 5, "closed"])],
    [2, events(["2026-02-03T12:00:00Z", null, "opened"])],
    [3, events(["2026-02-04T09:00:00Z", 2, "opened"])],
  ]);
  const points = burndown({ start: "2026-02-02", due: "2026-02-05", zone: "UTC" }, histories, at("2026-02-10T00:00:00Z"));
  assert.deepEqual(points.map((p) => p.remaining), [3, 5, 2, 2]);
  assert.ok(points.every((p) => !p.future));
});

test("days after the current day are future and show today's value", () => {
  const histories = new Map<number, HistoryEvent[]>([[1, events(["2026-02-02T09:00:00Z", 4, "opened"])], [2, events(["2026-02-02T09:00:00Z", 2, "opened"], ["2026-02-02T10:00:00Z", 2, "closed"])]]);
  const points = burndown({ start: "2026-02-02", due: "2026-02-05", zone: "UTC" }, histories, at("2026-02-02T23:00:00Z"));
  assert.deepEqual(points.map((p) => [p.day, p.remaining, p.future]), [
    ["2026-02-02", 4, false], ["2026-02-03", 4, true], ["2026-02-04", 4, true], ["2026-02-05", 4, true],
  ]);
});

test("the current day is judged in the milestone's zone", () => {
  const histories = new Map<number, HistoryEvent[]>([[1, events(["2026-02-02T09:00:00Z", 1, "opened"])]]);
  const tokyo = burndown({ start: "2026-02-02", due: "2026-02-03", zone: "Asia/Tokyo" }, histories, at("2026-02-02T16:00:00Z"));
  assert.deepEqual(tokyo.map((p) => p.future), [false, false]);
  const utc = burndown({ start: "2026-02-02", due: "2026-02-03", zone: "UTC" }, histories, at("2026-02-02T16:00:00Z"));
  assert.deepEqual(utc.map((p) => p.future), [false, true]);
});
