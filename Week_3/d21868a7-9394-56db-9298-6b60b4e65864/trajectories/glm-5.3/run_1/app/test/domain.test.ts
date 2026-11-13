import { capVolumeMl, turnoutMaxMl, rateMlDay, rationShares, remainingMl, effectiveCapMlDay, windowHours, windowStatus, isOrderable } from "../src/shared/domain.ts";
import { decStr3 } from "../src/shared/decimal.ts";

let fails = 0;
function check(name: string, got: string, want: string) {
  if (got !== want) {
    console.log(`FAIL ${name}: got "${got}" want "${want}"`);
    fails++;
  } else console.log(`ok   ${name}`);
}

// effective cap
check("effcap lower restriction", effectiveCapMlDay("60.000", "40.000"), "40.000");
check("effcap higher restriction", effectiveCapMlDay("40.000", "60.000"), "40.000");
check("effcap none", effectiveCapMlDay("60.000", null), "60.000");

// cap volumes from the brief's window table
check("W-L4-A 24h", capVolumeMl("60.000", null, null, 0, 24), "60.000");
check("W-09-A 12h", capVolumeMl("120.000", null, null, 0, 12), "60.000");
check("W-12-A 24h", capVolumeMl("30.000", null, null, 0, 24), "30.000");

// restricted: 40 ML/day at 150 minutes into a 24h window
{
  const opens = Date.UTC(2026, 9, 29, 20, 0, 0); // arbitrary
  const effAt = opens + 150 * 60000;
  check("restricted 42.083", capVolumeMl("60.000", "40.000", effAt, opens, 24), "42.083");
}

// turnout max volumes from the brief
check("T4-15 24h", turnoutMaxMl("25.000", 24), "25.000");
check("T9-02 12h", turnoutMaxMl("60.000", 12), "30.000");

// rates
check("rate 15/12h", rateMlDay("15.000", 12), "30.000");
check("rate 0.007/48h", rateMlDay("0.007", 48), "0.004");

// remaining
check("remaining 60-50", remainingMl("60.000", "50.000"), "10.000");

// window status
const t0 = Date.UTC(2026, 0, 1);
const wo = t0 + 100 * 3600 * 1000; // a window opening in 100h
check("status upcoming", windowStatus(t0 + 1000 * 3600, t0 + 2000 * 3600, t0), "upcoming");
check("status open", windowStatus(t0, t0 + 2000 * 3600, t0 + 100 * 3600), "open");
check("status closing", windowStatus(t0, t0 + 2000 * 3600, t0 + 1975 * 3600), "closing");
check("status closed", windowStatus(t0, t0 + 2000 * 3600, t0 + 2000 * 3600), "closed");
check("orderable at open-10d", String(isOrderable(wo, wo + 24 * 3600 * 1000, wo - 240 * 3600 * 1000)), "true");
check("not orderable just before", String(isOrderable(wo, wo + 24 * 3600 * 1000, wo - 240 * 3600 * 1000 - 1)), "false");
check("orderable mid-window", String(isOrderable(wo, wo + 24 * 3600 * 1000, wo + 1000)), "true");
check("not orderable at close", String(isOrderable(t0, t0 + 24 * 3600 * 1000, t0 + 24 * 3600 * 1000)), "false");
check("hours", String(windowHours(t0, t0 + 24 * 3600 * 1000)), "24");
check("hours 25", String(windowHours(t0, t0 + 25 * 3600 * 1000)), "25");
check("hours 23", String(windowHours(t0, t0 + 23 * 3600 * 1000)), "23");

// ration: the published example
{
  const candidates = [
    { orderNumber: "ORD-00004", growerId: 1, demand: "30.000" },
    { orderNumber: "ORD-00005", growerId: 2, demand: "20.000" },
  ];
  const { shares, scheduled } = rationShares(candidates, "10.001");
  check("ration share 1", shares.get("ORD-00004")!, "6.001");
  check("ration share 2", shares.get("ORD-00005")!, "4.000");
  let sum = 0n;
  for (const v of shares.values()) {
    const parts = v.split(".");
    sum += BigInt(parts[0]) * 1000n + BigInt(parts[1]);
  }
  check("ration shares sum to 10.001", String(sum), "10001");
  check("ration scheduled both", scheduled.join(","), "ORD-00004,ORD-00005");
}

// ration where D <= R: shares are demands
{
  const candidates = [
    { orderNumber: "ORD-00010", growerId: 1, demand: "2.000" },
    { orderNumber: "ORD-00011", growerId: 2, demand: "3.000" },
  ];
  const { shares, scheduled, leftRequested } = rationShares(candidates, "10.000");
  check("D<=R share1", shares.get("ORD-00010")!, "2.000");
  check("D<=R share2", shares.get("ORD-00011")!, "3.000");
  check("D<=R scheduled", scheduled.join(","), "ORD-00010,ORD-00011");
  check("D<=R left", leftRequested.join(","), "");
}

// ration with a 0.000 share staying requested
{
  const candidates = [
    { orderNumber: "ORD-00020", growerId: 1, demand: "10.000" },
    { orderNumber: "ORD-00021", growerId: 2, demand: "0.000" },
  ];
  const { shares, scheduled, leftRequested } = rationShares(candidates, "0.001");
  // D = 10.001 > R = 0.001; s1 = 10*0.001/10.001 -> 0.001; s2 = 0
  check("tiny R share1", shares.get("ORD-00020")!, "0.001");
  check("tiny R share2", shares.get("ORD-00021")!, "0.000");
  check("tiny R scheduled", scheduled.join(","), "ORD-00020");
  check("tiny R left", leftRequested.join(","), "ORD-00021");
}

// ration leftover distribution ties to lower order number
{
  // R = 3.000, demands 1 and 2: shares 1.000 and 2.000 exactly, no leftover
  const candidates = [
    { orderNumber: "ORD-00030", growerId: 1, demand: "1.000" },
    { orderNumber: "ORD-00031", growerId: 2, demand: "2.000" },
  ];
  const { shares } = rationShares(candidates, "3.000");
  check("exact split 1", shares.get("ORD-00030")!, "1.000");
  check("exact split 2", shares.get("ORD-00031")!, "2.000");
}

// ration: three candidates with remainder ordering
{
  // R = 1.000, demands 5, 5, 5 -> D = 15, raw shares 0.3333 -> 0.333 each, sum 0.999, leftover 1 thousandth
  const candidates = [
    { orderNumber: "ORD-00040", growerId: 1, demand: "5.000" },
    { orderNumber: "ORD-00041", growerId: 2, demand: "5.000" },
    { orderNumber: "ORD-00042", growerId: 3, demand: "5.000" },
  ];
  const { shares } = rationShares(candidates, "1.000");
  let sum = 0n;
  for (const v of shares.values()) {
    const parts = v.split(".");
    sum += BigInt(parts[0]) * 1000n + BigInt(parts[1]);
  }
  check("3-way sum to 1.000", String(sum), "1000");
  check("tie goes to lowest order", shares.get("ORD-00040")!, "0.334");
  check("other two", shares.get("ORD-00041")! + "," + shares.get("ORD-00042")!, "0.333,0.333");
}

console.log(fails === 0 ? "ALL OK" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
