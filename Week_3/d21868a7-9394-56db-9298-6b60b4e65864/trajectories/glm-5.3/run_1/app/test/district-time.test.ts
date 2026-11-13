import { windowLabel, formatInstant, parseInstant, districtOffsetMinutes, districtDate, labelPart } from "../src/shared/district-time.ts";

let fails = 0;
function check(name: string, got: string, want: string) {
  if (got !== want) {
    console.log(`FAIL ${name}: got "${got}" want "${want}"`);
    fails++;
  } else {
    console.log(`ok   ${name}`);
  }
}

// Published examples from the brief
const t1o = parseInstant("2027-04-03T13:00:00Z")!;
const t1c = parseInstant("2027-04-04T14:00:00Z")!;
check("DST ends label", windowLabel(t1o, t1c), "Sun 4 Apr 00:00 to Mon 5 Apr 00:00");

const t2o = parseInstant("2026-10-03T14:00:00Z")!;
const t2c = parseInstant("2026-10-04T13:00:00Z")!;
check("DST starts label", windowLabel(t2o, t2c), "Sun 4 Oct 00:00 to Mon 5 Oct 00:00");

const t3o = parseInstant("2027-04-03T15:30:00Z")!;
const t3c = parseInstant("2027-04-03T17:30:00Z")!;
check("repeated hour first pass", windowLabel(t3o, t3c), "Sun 4 Apr 02:30 AEDT to Sun 4 Apr 03:30");

const t4o = parseInstant("2027-04-03T16:30:00Z")!;
const t4c = parseInstant("2027-04-03T17:30:00Z")!;
check("repeated hour second pass", windowLabel(t4o, t4c), "Sun 4 Apr 02:30 AEST to Sun 4 Apr 03:30");

// offsets
check("AEST offset before DST start Oct 2026", String(districtOffsetMinutes(t2o)), "600");
check("AEDT after DST start", String(districtOffsetMinutes(parseInstant("2026-10-04T15:00:00Z")!)), "660");
check("AEST offset Apr 2027", String(districtOffsetMinutes(t1c)), "600");
const jan = parseInstant("2027-01-15T00:00:00Z")!;
check("AEDT offset Jan 2027", String(districtOffsetMinutes(jan)), "660");
const jun = parseInstant("2027-06-15T00:00:00Z")!;
check("AEST offset Jun 2027", String(districtOffsetMinutes(jun)), "600");

// district dates
check("date of 2026-10-03T13:30Z (23:30 local)", districtDate(parseInstant("2026-10-03T13:30:00Z")!), "2026-10-03");
check("date of 2026-10-03T14:00Z (00:00 local)", districtDate(parseInstant("2026-10-03T14:00:00Z")!), "2026-10-04");
check("date of repeated-hour window", districtDate(t3o), "2027-04-04");

// instant format round trip
check("instant format", formatInstant(t1o), "2027-04-03T13:00:00Z");
check("instant parse rejects", String(parseInstant("2027-04-03 13:00:00")), "null");
check("instant parse rejects millis", String(parseInstant("2027-04-03T13:00:00.000Z")), "null");

// label example from order form options (06:00 AEDT local on 29/30 Oct)
const lo = parseInstant("2026-10-28T19:00:00Z")!;
const lc = parseInstant("2026-10-29T19:00:00Z")!;
check("Thu 29 Oct 06:00 to Fri 30 Oct 06:00", windowLabel(lo, lc), "Thu 29 Oct 06:00 to Fri 30 Oct 06:00");

console.log(fails === 0 ? "ALL OK" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
