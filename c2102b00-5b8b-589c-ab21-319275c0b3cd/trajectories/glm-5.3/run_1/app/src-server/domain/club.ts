import { all, one, run, tx, HouseholdRow, ProductRow, CycleRow, LineRow, PledgeRow } from "../db";

export function clubTimeZone(): string {
  const row = one<{ time_zone: string }>("SELECT time_zone FROM club WHERE id = 1");
  return row?.time_zone ?? "UTC";
}

export function clubInfo(): { name: string; time_zone: string; distributor: string } {
  const row = one<{ name: string; time_zone: string; distributor: string }>("SELECT * FROM club WHERE id = 1")!;
  return row;
}

export function household(code: string): HouseholdRow | undefined {
  return one<HouseholdRow>("SELECT * FROM households WHERE code = ?", code);
}

export function householdByEmail(email: string): HouseholdRow | undefined {
  return one<HouseholdRow>("SELECT * FROM households WHERE email = ?", email);
}

export function product(id: string): ProductRow | undefined {
  return one<ProductRow>("SELECT * FROM products WHERE id = ?", id);
}

export function catalogue(): ProductRow[] {
  return all<ProductRow>("SELECT * FROM products ORDER BY sort_order, id");
}

export function cycle(id: string): CycleRow | undefined {
  return one<CycleRow>("SELECT * FROM cycles WHERE id = ?", id);
}

export function line(cycleId: string, productId: string): LineRow | undefined {
  return one<LineRow>("SELECT * FROM lines WHERE cycle_id = ? AND product_id = ?", cycleId, productId);
}

export function cycleProducts(cycleId: string): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.* FROM cycle_products cp JOIN products p ON p.id = cp.product_id
     WHERE cp.cycle_id = ? ORDER BY cp.sort_order, p.sort_order`,
    cycleId
  );
}

export function pledgesOfLine(cycleId: string, productId: string): PledgeRow[] {
  return all<PledgeRow>(
    "SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? ORDER BY id",
    cycleId, productId
  );
}

export function nextCycleId(): string {
  const rows = all<{ id: string }>("SELECT id FROM cycles");
  let max = 44;
  for (const r of rows) {
    const m = /^cy-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `cy-${max + 1}`;
}

/** The single place that decides a cycle's effective status and acceptance. */
export function effectiveStatus(c: CycleRow, nowSec: number): string {
  if (c.status === "open" && c.cutoff_at !== null && nowSec >= c.cutoff_at) return "sealing";
  return c.status;
}

export function acceptingPledges(c: CycleRow, nowSec: number): boolean {
  return c.status === "open" && c.cutoff_at !== null && nowSec < c.cutoff_at;
}

export function bumpVersion(cycleId: string, productId: string): void {
  run("UPDATE lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?", cycleId, productId);
}

export interface UnitOwner {
  unitIndex: number; // 1-based, pledge order
  householdCode: string;
}

/** Units 1..pack in pledge order, with the pledger that holds each. */
export function unitOwners(cycleId: string, productId: string): UnitOwner[] {
  const rows = pledgesOfLine(cycleId, productId);
  const out: UnitOwner[] = [];
  let index = 1;
  for (const p of rows) {
    for (let i = 0; i < p.units; i++) {
      out.push({ unitIndex: index++, householdCode: p.household_code });
    }
  }
  return out;
}

/** The single place that decides unit shares, including the leftover-cent rule. */
export function unitShares(priceCents: number, pack: number): { base: number; remainder: number } {
  const base = Math.floor(priceCents / pack);
  const remainder = priceCents - base * pack;
  return { base, remainder };
}

/** Share of one unit, 1-based in pledge order. */
export function unitShare(priceCents: number, pack: number, unitIndex: number): number {
  const { base, remainder } = unitShares(priceCents, pack);
  return base + (unitIndex <= remainder ? 1 : 0);
}

/** Per-unit hold amount: price divided by pack, rounded up to a whole cent. */
export function unitHoldCents(priceCents: number, pack: number): number {
  return Math.ceil(priceCents / pack);
}
