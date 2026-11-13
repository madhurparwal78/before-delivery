import {
  chargeCents, billableMinutes, wallToInstant, cancellationCutoff, weekMonday,
  segments, segmentIndexAt, centsToMoney, parseDollars, defaultTeamSize, derivedStatus,
  type Segment,
} from "../src/shared/domain.js";

let failures = 0;
function eq(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", label, "->", JSON.stringify(got), ok ? "" : `(want ${JSON.stringify(want)})`);
}

eq("CR-1006 charge", centsToMoney(chargeCents(127, 8625, 2)), "388.13");
eq("CR-1007 charge", centsToMoney(chargeCents(40, 11000, 1)), "220.00");
eq("billable 127", billableMinutes(127), 135);
eq("billable 40", billableMinutes(40), 120);
eq("billable 120", billableMinutes(120), 120);
eq("billable 121", billableMinutes(121), 135);
eq("cutoff spring", cancellationCutoff("2027-03-15T09:00:00-04:00"), "2027-03-13T09:00:00-05:00");
eq("cutoff fall", cancellationCutoff("2027-11-08T09:00:00-05:00"), "2027-11-06T09:00:00-04:00");
eq("skipped wall", wallToInstant("2027-03-14T02:30"), null);
eq("fall-back wall", wallToInstant("2026-11-01T01:30"), "2026-11-01T01:30:00-04:00");
eq("normal wall", wallToInstant("2026-11-03T09:00"), "2026-11-03T09:00:00-05:00");
eq("monday", weekMonday("2026-11-11T12:00:00-05:00"), "2026-11-09");
eq("segments 120/20 len", segments(120, 20, 2).length, 6);
eq("segments 210/30 len", segments(210, 30, 2).length, 7);
eq("segments solo active", segments(50, 20, 1).every((s: Segment) => s.active === "A"), true);
eq("segmentIndexAt", [0, 20, 119, 120].map((m) => segmentIndexAt(m, 120, 20)), [0, 1, 5, 5]);
eq("team 61min", defaultTeamSize(61), 2);
eq("team 60min", defaultTeamSize(60), 1);
eq("derived 0/2", derivedStatus(0, 2), "submitted");
eq("derived 1/2", derivedStatus(1, 2), "half_staffed");
eq("derived 2/2", derivedStatus(2, 2), "staffed");
eq("parseDollars", parseDollars("388.13"), 38813);
eq("parseDollars neg", parseDollars("-1.00"), -100);
eq("parseDollars bad", parseDollars("3.1"), null);
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
