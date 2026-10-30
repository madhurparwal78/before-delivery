import { resolveLocalTime } from "../src/server/handlers/notes.js";
let fails = 0;
function check(name: string, local: string, timeZone: string, want: string): void {
  const r = resolveLocalTime(local, timeZone, new Date("2026-10-30T00:00:00Z"));
  const got = r.instant === null ? "null" : r.instant.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (got !== want) { console.error(`FAIL ${name}: ${local} in ${timeZone}: got ${got} want ${want}`); fails++; }
  else console.log(`ok   ${name}`);
}
// The brief's two examples (America/New_York).
check("skipped time", "2027-03-14T02:30", "America/New_York", "2027-03-14T07:30:00Z");
check("twice time", "2027-11-07T01:30", "America/New_York", "2027-11-07T05:30:00Z");
// Normal times.
check("normal EST", "2027-01-15T09:00", "America/New_York", "2027-01-15T14:00:00Z");
check("normal EDT", "2027-06-15T09:00", "America/New_York", "2027-06-15T13:00:00Z");
check("berlin", "2027-06-15T09:00", "Europe/Berlin", "2027-06-15T07:00:00Z");
check("berlin skipped", "2027-03-28T02:30", "Europe/Berlin", "2027-03-28T01:30:00Z");
check("invalid format", "2027-13-01T00:00", "UTC", "null");
console.log(fails === 0 ? "all DST tests passed" : `${fails} DST failures`);
