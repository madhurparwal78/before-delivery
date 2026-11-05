// A cycle's case lines: pledges in pledge order, units to go, cells and the line version.
import { all, one, run } from "./db.js";
import type { PledgeRow } from "./shares.js";
import { allShortShares } from "./shorts.js";
import type { Viewer } from "./session.js";

export type LineStatus = "filling" | "sealed" | "dropped" | "taken_up";

export interface LineRow {
  cycle_id: string;
  product_id: string;
  position: number;
  version: number;
  status: LineStatus;
  case_name: string;
  pack: number;
  unit: string;
  price_cents: number;
}

const LINE_SELECT = `SELECT l.cycle_id, l.product_id, l.position, l.version, l.status, p.case_name, p.pack, p.unit,
  p.price_cents FROM lines l JOIN products p ON p.id = l.product_id`;

export function lineRows(cycleId: string): LineRow[] {
  return all<LineRow>(`${LINE_SELECT} WHERE l.cycle_id = ? ORDER BY l.position`, cycleId);
}

export function lineRow(cycleId: string, productId: string): LineRow | undefined {
  return one<LineRow>(`${LINE_SELECT} WHERE l.cycle_id = ? AND l.product_id = ?`, cycleId, productId);
}

/** Pledges on a line in pledge order: the order each pledge was first created. */
export function linePledges(cycleId: string, productId: string): PledgeRow[] {
  return all<PledgeRow>(
    "SELECT id, pledger, units FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id",
    cycleId, productId,
  );
}

export function shortUnitsOn(cycleId: string, productId: string): number {
  return (
    one<{ n: number | null }>("SELECT SUM(units) AS n FROM shorts WHERE cycle_id = ? AND product_id = ?", cycleId, productId)
      ?.n ?? 0
  );
}

/** Units to go: the pack minus every pledged unit. */
export function unitsToGo(pack: number, pledges: PledgeRow[]): number {
  return pack - pledges.reduce((sum, p) => sum + p.units, 0);
}

/** One cell per unit in pledge order: the viewer's household's units are `mine`. */
function cellsOf(pack: number, pledges: PledgeRow[], household: string | null): string[] {
  const cells: string[] = [];
  for (const p of pledges) for (let i = 0; i < p.units; i++) cells.push(p.pledger === household ? "mine" : "taken");
  while (cells.length < pack) cells.push("empty");
  return cells;
}

/** A filling or sealed case follows its units to go; resolved cases keep their resolution. */
export function settledStatus(current: LineStatus, toGo: number): LineStatus {
  if (current === "dropped" || current === "taken_up") return current;
  return toGo === 0 ? "sealed" : "filling";
}

/** Records a committed change to the line: its version rises by exactly 1. */
export function bumpLine(cycleId: string, productId: string, status: LineStatus): void {
  run("UPDATE lines SET version = version + 1, status = ? WHERE cycle_id = ? AND product_id = ?", status, cycleId, productId);
}

export function lineJson(row: LineRow, viewer: Viewer) {
  const pledges = linePledges(row.cycle_id, row.product_id);
  const toGo = unitsToGo(row.pack, pledges);
  const shortUnits = shortUnitsOn(row.cycle_id, row.product_id);
  const household = viewer.role === "member" ? viewer.household_code : null;
  const mine = household === null ? null : pledges.find((p) => p.pledger === household)?.units ?? 0;
  const myShort =
    household === null
      ? null
      : allShortShares(pledges, row.price_cents, row.pack, shortUnits).get(household)?.short_units ?? 0;
  return {
    product_id: row.product_id,
    case_name: row.case_name,
    pack: row.pack,
    unit: row.unit,
    price_cents: row.price_cents,
    version: row.version,
    pledged_units: row.pack - toGo,
    units_to_go: toGo,
    status: row.status,
    short_units: shortUnits,
    my_units: mine,
    my_short_units: myShort,
    cells: cellsOf(row.pack, pledges, household),
  };
}
