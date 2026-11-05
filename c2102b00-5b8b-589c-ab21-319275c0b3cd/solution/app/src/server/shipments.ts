// Recording short shipments: the short is tracked beside the pledges, which never change.
import { effectiveStatus, visibleCycle } from "./cycles.js";
import { nowSeconds, run } from "./db.js";
import { conflict, invalid, notFound, type Reply } from "./errors.js";
import { bumpLine, lineJson, linePledges, lineRow, shortUnitsOn } from "./lines.js";
import { householdRow } from "./households.js";
import { queueMail } from "./mail.js";
import { allow, type Viewer } from "./session.js";
import { shortShares } from "./shorts.js";

/**
 * Records short units on a sealed or taken-up case and queues one notice per affected household.
 * The remaining-units check and the short are written in the same transaction.
 */
export function recordShort(viewer: Viewer, cycleId: string, productId: string, body: Record<string, unknown>): Reply {
  const cycle = visibleCycle(cycleId, viewer);
  const line = lineRow(cycleId, productId);
  if (!line) throw notFound("No such case in this cycle.");
  allow(viewer, "coordinator");
  const status = effectiveStatus(cycle);
  if (status !== "received" && status !== "breakdown") {
    throw conflict("wrong_cycle_state", "Shorts are recorded once the delivery is received.");
  }
  if (line.status !== "sealed" && line.status !== "taken_up") throw conflict("line_not_sealed", `${line.case_name} was not ordered.`);
  const already = shortUnitsOn(cycleId, productId);
  const remaining = line.pack - already;
  const units = body.units;
  if (!Number.isInteger(units) || (units as number) < 1 || (units as number) > remaining) {
    throw invalid("units", `Enter 1 to ${remaining} units.`);
  }
  const pledges = linePledges(cycleId, productId);
  const affected = shortShares(pledges, line.price_cents, line.pack, already, units as number);
  const shortId = run(
    "INSERT INTO shorts (cycle_id, product_id, units, created_at) VALUES (?, ?, ?, ?)",
    cycleId, productId, units as number, nowSeconds(),
  ).lastId;
  bumpLine(cycleId, productId, line.status);
  for (const a of affected) {
    const household = householdRow(a.pledger);
    if (!household) continue; // the club's own units get no notice
    const pledged = pledges.find((p) => p.pledger === a.pledger)!.units;
    queueMail({
      kind: "short",
      cycleId,
      household: household.code,
      recipient: household.email,
      messageId: `short-${shortId}-${household.code}@tare-and-tally.example`,
      subject: `Short shipment: ${line.case_name}`,
      body: `${cycle.name}: ${a.short_units} of your ${pledged} units of ${line.case_name} did not arrive. You will not be charged for them.`,
    });
  }
  return {
    status: 201,
    body: { short_id: shortId, line: lineJson(lineRow(cycleId, productId)!, viewer), affected },
  };
}
