// Breakdown bags: each household's pledged units less its short units, packed inside the pickup window.
import { HOUR, isoInstant, pickupDisplay } from "./clubtime.js";
import { type CycleRow, effectiveStatus, visibleCycle } from "./cycles.js";
import { all, nowSeconds, one, run } from "./db.js";
import { conflict, invalid, notFound, type Reply } from "./errors.js";
import { linePledges, lineRows, shortUnitsOn } from "./lines.js";
import { allow, type Viewer } from "./session.js";
import { households } from "./households.js";
import { allShortShares } from "./shorts.js";

/** The pickup window: from 12 hours of elapsed time before pickup starts until pickup ends. */
function insidePickupWindow(c: CycleRow, now = nowSeconds()): boolean {
  return c.pickup_start_at !== null && c.pickup_end_at !== null && now >= c.pickup_start_at - 12 * HOUR && now <= c.pickup_end_at;
}

function bagsOf(cycleId: string) {
  const items = new Map<string, { product_id: string; case_name: string; units: number }[]>();
  for (const line of lineRows(cycleId)) {
    if (line.status === "dropped") continue;
    const pledges = linePledges(cycleId, line.product_id);
    const shorts = allShortShares(pledges, line.price_cents, line.pack, shortUnitsOn(cycleId, line.product_id));
    for (const p of pledges) {
      const units = p.units - (shorts.get(p.pledger)?.short_units ?? 0);
      if (p.pledger === "club" || units === 0) continue;
      items.set(p.pledger, [...(items.get(p.pledger) ?? []), { product_id: line.product_id, case_name: line.case_name, units }]);
    }
  }
  const packed = new Set(
    all<{ household_code: string; product_id: string }>(
      "SELECT household_code, product_id FROM bag_items WHERE cycle_id = ? AND packed = 1", cycleId,
    ).map((b) => `${b.household_code}/${b.product_id}`),
  );
  const flagged = new Map(
    all<{ household_code: string; product_id: string; units: number }>(
      "SELECT household_code, product_id, SUM(units) AS units FROM flags WHERE cycle_id = ? GROUP BY household_code, product_id",
      cycleId,
    ).map((f) => [`${f.household_code}/${f.product_id}`, f.units]),
  );
  return households()
    .filter((h) => items.has(h.code))
    .map((h) => {
      const list = items.get(h.code)!.map((i) => ({
        ...i,
        packed: packed.has(`${h.code}/${i.product_id}`),
        flagged_units: flagged.get(`${h.code}/${i.product_id}`) ?? 0,
      }));
      return { household_code: h.code, household_name: h.name, packed: list.every((i) => i.packed), items: list };
    });
}

function breakdownCycle(viewer: Viewer, cycleId: string, roles: ("volunteer" | "coordinator")[]) {
  const c = visibleCycle(cycleId, viewer);
  allow(viewer, ...roles);
  return c;
}

const BEFORE_BREAKDOWN = ["draft", "open", "sealing", "ordered", "received"];

export function listBags(viewer: Viewer, cycleId: string): Reply {
  const c = breakdownCycle(viewer, cycleId, ["volunteer", "coordinator"]);
  if (BEFORE_BREAKDOWN.includes(effectiveStatus(c))) throw conflict("wrong_cycle_state", "Bags open at breakdown.");
  return { status: 200, body: { bags: bagsOf(cycleId) } };
}

function packingItem(c: CycleRow, household: string, productId: string) {
  const bag = bagsOf(c.id).find((b) => b.household_code === household);
  const item = bag?.items.find((i) => i.product_id === productId);
  if (!bag || !item) throw notFound("No such bag item.");
  if (effectiveStatus(c) !== "breakdown") throw conflict("wrong_cycle_state", "Bags are packed during breakdown.");
  if (!insidePickupWindow(c)) {
    throw conflict("outside_pickup_window", `Outside the pickup window. Pickup is ${pickupDisplay(c.pickup_start_at!, c.pickup_end_at!)}.`);
  }
  return item;
}

export function packItem(viewer: Viewer, cycleId: string, household: string, productId: string, body: Record<string, unknown>): Reply {
  const c = breakdownCycle(viewer, cycleId, ["volunteer", "coordinator"]);
  packingItem(c, household, productId);
  if (typeof body.packed !== "boolean") throw invalid("packed", "Send packed as true or false.");
  run(
    `INSERT INTO bag_items (cycle_id, household_code, product_id, packed) VALUES (?, ?, ?, ?)
     ON CONFLICT (cycle_id, household_code, product_id) DO UPDATE SET packed = excluded.packed`,
    cycleId, household, productId, body.packed ? 1 : 0,
  );
  return { status: 200, body: bagsOf(cycleId).find((b) => b.household_code === household) };
}

interface FlagRow {
  id: number;
  household_code: string;
  product_id: string;
  units: number;
  created_at: string;
}

export function flagShort(viewer: Viewer, cycleId: string, household: string, body: Record<string, unknown>): Reply {
  const c = breakdownCycle(viewer, cycleId, ["volunteer"]);
  const productId = body.product_id;
  const bag = bagsOf(cycleId).find((b) => b.household_code === household);
  if (!bag) throw notFound("No such bag.");
  if (typeof productId !== "string" || !bag.items.some((i) => i.product_id === productId)) {
    throw invalid("product_id", "Choose an item in this bag.");
  }
  const item = packingItem(c, household, productId);
  const units = body.units;
  if (!Number.isInteger(units) || (units as number) < 1 || (units as number) > item.units) {
    throw invalid("units", `Enter 1 to ${item.units} units.`);
  }
  const id = run(
    "INSERT INTO flags (cycle_id, household_code, product_id, units, created_at) VALUES (?, ?, ?, ?, ?)",
    cycleId, household, productId, units as number, isoInstant(nowSeconds()),
  ).lastId;
  return { status: 201, body: { flag: one<FlagRow>("SELECT id, household_code, product_id, units, created_at FROM flags WHERE id = ?", id) } };
}

export function listFlags(viewer: Viewer, cycleId: string): Reply {
  visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  return {
    status: 200,
    body: { flags: all<FlagRow>("SELECT id, household_code, product_id, units, created_at FROM flags WHERE cycle_id = ? ORDER BY id", cycleId) },
  };
}
