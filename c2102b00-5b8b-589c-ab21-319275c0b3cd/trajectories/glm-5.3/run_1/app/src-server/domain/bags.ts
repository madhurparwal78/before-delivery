import { CycleRow, all, one, run, tx } from "../db";
import { errors } from "../errors";
import { shortSummary } from "./shorts";
import { product, cycleProducts } from "./club";

export interface BagItem {
  product_id: string;
  case_name: string;
  units: number;
  packed: boolean;
  flagged_units: number;
}

export interface Bag {
  household_code: string;
  household_name: string;
  packed: boolean;
  items: BagItem[];
}

/** The single place that decides the pickup window. */
export function inPickupWindow(c: CycleRow, nowSec: number): boolean {
  if (c.pickup_start_at === null || c.pickup_end_at === null) return false;
  return nowSec >= c.pickup_start_at - 12 * 3600 && nowSec <= c.pickup_end_at;
}

export function bagsOf(c: CycleRow): Bag[] {
  const products = cycleProducts(c.id);
  const households = all<{ code: string; name: string }>(
    `SELECT DISTINCT h.code, h.name FROM pledges pl
     JOIN households h ON h.code = pl.household_code
     WHERE pl.cycle_id = ? AND pl.household_code != 'club'
     ORDER BY h.code`,
    c.id
  );
  const bags: Bag[] = [];
  for (const hh of households) {
    const items: BagItem[] = [];
    for (const p of products) {
      const pledged = one<{ n: number }>(
        "SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?",
        c.id, p.id, hh.code
      )?.n;
      if (!pledged) continue;
      const line = one<{ status: string }>("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", c.id, p.id)!;
      if (line.status === "dropped") continue;
      const short = shortSummary(c.id, p.id, hh.code).units;
      const units = pledged - short;
      if (units <= 0) continue;
      const item = one<{ packed: number; flagged_units: number }>(
        "SELECT packed, flagged_units FROM bag_items WHERE cycle_id = ? AND household_code = ? AND product_id = ?",
        c.id, hh.code, p.id
      );
      items.push({
        product_id: p.id,
        case_name: p.case_name,
        units,
        packed: item?.packed === 1,
        flagged_units: item?.flagged_units ?? 0,
      });
    }
    if (items.length === 0) continue;
    bags.push({
      household_code: hh.code,
      household_name: hh.name,
      packed: items.every((i) => i.packed),
      items,
    });
  }
  return bags;
}

export function bagOf(c: CycleRow, householdCode: string): Bag | undefined {
  return bagsOf(c).find((b) => b.household_code === householdCode);
}

/** Toggles one bag item; the window and state are decided in one transaction. */
export function setBagItem(c: CycleRow, householdCode: string, productId: string, packed: boolean, nowSec: number): Bag {
  return tx(() => {
    const cyc = one<CycleRow>("SELECT * FROM cycles WHERE id = ?", c.id)!;
    if (cyc.status !== "breakdown") throw errors.wrongCycleState();
    if (!inPickupWindow(cyc, nowSec)) throw errors.outsidePickupWindow();
    const p = product(productId);
    if (!p) throw errors.notFound();
    const existing = one<{ packed: number }>(
      "SELECT packed FROM bag_items WHERE cycle_id = ? AND household_code = ? AND product_id = ?",
      c.id, householdCode, productId
    );
    if (existing) {
      run("UPDATE bag_items SET packed = ? WHERE cycle_id = ? AND household_code = ? AND product_id = ?", packed ? 1 : 0, c.id, householdCode, productId);
    } else {
      run(
        "INSERT INTO bag_items (cycle_id, household_code, product_id, packed, flagged_units) VALUES (?, ?, ?, ?, 0)",
        c.id, householdCode, productId, packed ? 1 : 0
      );
    }
    return bagOf(cyc, householdCode)!;
  });
}

export function addFlag(c: CycleRow, householdCode: string, productId: string, units: number, nowSec: number): {
  id: number;
  household_code: string;
  product_id: string;
  units: number;
  created_at: number;
} {
  return tx(() => {
    const cyc = one<CycleRow>("SELECT * FROM cycles WHERE id = ?", c.id)!;
    if (cyc.status !== "breakdown") throw errors.wrongCycleState();
    if (!inPickupWindow(cyc, nowSec)) throw errors.outsidePickupWindow();
    const bag = bagOf(cyc, householdCode);
    if (!bag) throw errors.notFound();
    const item = bag.items.find((i) => i.product_id === productId);
    if (!item) throw errors.notFound();
    if (units < 1 || units > item.units) {
      throw errors.validation({ units: `Enter 1 to ${item.units} units.` });
    }
    const f = run(
      "INSERT INTO flags (cycle_id, household_code, product_id, units, created_at) VALUES (?, ?, ?, ?, ?)",
      c.id, householdCode, productId, units, nowSec
    );
    run(
      "UPDATE bag_items SET flagged_units = flagged_units + ? WHERE cycle_id = ? AND household_code = ? AND product_id = ?",
      units, c.id, householdCode, productId
    );
    return { id: Number(f.lastInsertRowid), household_code: householdCode, product_id: productId, units, created_at: nowSec };
  });
}

export function flagsOf(cycleId: string): { id: number; household_code: string; product_id: string; units: number; created_at: number }[] {
  return all(
    "SELECT id, household_code, product_id, units, created_at FROM flags WHERE cycle_id = ? ORDER BY id",
    cycleId
  );
}
