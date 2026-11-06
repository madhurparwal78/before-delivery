import { CycleRow, all, one, run, tx } from "../db";
import { ApiError, errors } from "../errors";
import { bumpVersion, cycle, line, product, unitOwners, unitShare } from "./club";
import { queueShortNotices } from "./mail";

export interface ShortAssignment {
  pledger: string;
  short_units: number;
  credit_cents: number;
}

/**
 * The single place that decides short-unit selection: the remaining-units
 * check and the short it allows share one write transaction.
 */
export function recordShort(c: CycleRow, productId: string, units: number): {
  shortId: number;
  affected: ShortAssignment[];
} {
  const nowSec = Math.floor(Date.now() / 1000);
  const result = tx(() => {
    const cyc = cycle(c.id)!;
    if (cyc.status !== "received" && cyc.status !== "breakdown") throw errors.wrongCycleState();
    const ln = line(c.id, productId);
    if (!ln) throw errors.notFound();
    if (ln.status !== "sealed" && ln.status !== "taken_up") throw errors.lineNotSealed();
    const p = product(productId)!;
    const alreadyShort = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM short_units WHERE cycle_id = ? AND product_id = ?",
      c.id, productId
    )!.n;
    const delivered = p.pack;
    const remaining = delivered - alreadyShort;
    if (units < 1 || units > remaining) {
      throw errors.validation({ units: `Enter 1 to ${remaining} units.` });
    }
    // Latest pledges first: highest-numbered units not already short.
    const owners = unitOwners(c.id, productId);
    const shortUnitRows = all<{ unit_index: number }>(
      "SELECT unit_index FROM short_units WHERE cycle_id = ? AND product_id = ?",
      c.id, productId
    );
    const takenIdx = new Set(shortUnitRows.map((r) => r.unit_index));
    const candidates = owners
      .map((o) => o.unitIndex)
      .filter((idx) => !takenIdx.has(idx))
      .sort((a, b) => b - a);
    const chosen = candidates.slice(0, units);
    const ins = run(
      "INSERT INTO shorts (cycle_id, product_id, units, recorded_at) VALUES (?, ?, ?, ?)",
      c.id, productId, units, nowSec
    );
    const shortId = Number(ins.lastInsertRowid);
    const byPledger = new Map<string, { units: number; credit: number }>();
    for (const idx of chosen) {
      const owner = owners.find((o) => o.unitIndex === idx)!;
      run(
        "INSERT INTO short_units (cycle_id, product_id, unit_index, household_code, short_id) VALUES (?, ?, ?, ?, ?)",
        c.id, productId, idx, owner.householdCode, shortId
      );
      const credit = unitShare(p.price_cents, p.pack, idx);
      const agg = byPledger.get(owner.householdCode) ?? { units: 0, credit: 0 };
      agg.units += 1;
      agg.credit += credit;
      byPledger.set(owner.householdCode, agg);
    }
    bumpVersion(c.id, productId);
    return { shortId, byPledger };
  });
  const affected: ShortAssignment[] = [];
  for (const [pledger, agg] of result.byPledger) {
    if (pledger === "club") continue;
    affected.push({ pledger, short_units: agg.units, credit_cents: agg.credit });
  }
  queueShortNotices(c, productId, result.shortId, affected);
  return { shortId: result.shortId, affected };
}

/** A household's short units on a case, and their credit sum. */
export function shortSummary(cycleId: string, productId: string, householdCode: string): { units: number; creditCents: number } {
  const rows = all<{ unit_index: number }>(
    "SELECT unit_index FROM short_units WHERE cycle_id = ? AND product_id = ? AND household_code = ?",
    cycleId, productId, householdCode
  );
  const p = product(productId)!;
  let credit = 0;
  for (const r of rows) credit += unitShare(p.price_cents, p.pack, r.unit_index);
  return { units: rows.length, creditCents: credit };
}
