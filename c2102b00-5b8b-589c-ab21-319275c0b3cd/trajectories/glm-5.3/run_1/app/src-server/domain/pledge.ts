import { CycleRow, PledgeRow, all, one, run, tx } from "../db";
import { errors } from "../errors";
import { acceptingPledges, bumpVersion, cycle, line, product, unitHoldCents } from "./club";
import { heldCents } from "./ledger";
import { pledgesOfLine } from "./club";

export interface PledgeOutcome {
  pledgedUnits: number;
}

/**
 * The single place a pledge is decided and written: cutoff, pack and credit
 * checks and the pledge itself share one write transaction.
 */
export function putPledge(c: CycleRow, productId: string, householdCode: string, units: number, nowSec: number): void {
  const p = product(productId);
  if (!p) throw errors.notFound();
  tx(() => {
    const cyc = cycle(c.id)!;
    const ln = line(c.id, productId);
    if (!ln) throw errors.notFound();
    if (!acceptingPledges(cyc, nowSec)) throw errors.cutoffPassed();
    const existing = all<PledgeRow>("SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?", c.id, productId, householdCode)[0];
    const others = all<PledgeRow>(
      "SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code != ? ORDER BY id",
      c.id, productId, householdCode
    );
    const pledgedByOthers = others.reduce((n, r) => n + r.units, 0);
    const current = existing?.units ?? 0;
    const totalAfter = pledgedByOthers + units;
    if (totalAfter > p.pack) {
      throw errors.notEnoughUnits(p.pack - pledgedByOthers);
    }
    // Credit: the new hold for this pledge replaces its old one.
    const holdCents = units * unitHoldCents(p.price_cents, p.pack);
    const balance = one<{ b: number }>(
      "SELECT COALESCE(SUM(l.amount_cents), 0) AS b FROM legs l WHERE l.account = ?",
      `household:${householdCode}`
    )!.b;
    const holdRows = all<{ units: number; price_cents: number; pack: number }>(
      `SELECT pl.units, pr.price_cents, pr.pack FROM pledges pl
       JOIN products pr ON pr.id = pl.product_id
       JOIN cycles cy ON cy.id = pl.cycle_id
       LEFT JOIN lines l ON l.cycle_id = pl.cycle_id AND l.product_id = pl.product_id
       WHERE pl.household_code = ? AND cy.status != 'closed' AND (l.status IS NULL OR l.status != 'dropped')
         AND NOT (pl.cycle_id = ? AND pl.product_id = ?)`,
      householdCode, c.id, productId
    );
    const holdsOther = holdRows.reduce((n, r) => n + r.units * unitHoldCents(r.price_cents, r.pack), 0);
    if (balance - (holdsOther + holdCents) < 0) {
      throw errors.insufficientCredit();
    }
    const delta = units - current;
    if (existing) {
      run("UPDATE pledges SET units = ? WHERE id = ?", units, existing.id);
    } else {
      run(
        "INSERT INTO pledges (cycle_id, product_id, household_code, units, created_at) VALUES (?, ?, ?, ?, ?)",
        c.id, productId, householdCode, units, nowSec
      );
    }
    run(
      "INSERT INTO pledge_events (cycle_id, product_id, household_code, delta_units, accepted_at) VALUES (?, ?, ?, ?, ?)",
      c.id, productId, householdCode, delta, nowSec
    );
    bumpVersion(c.id, productId);
    const newStatus = totalAfter === p.pack ? "sealed" : "filling";
    run("UPDATE lines SET status = ? WHERE cycle_id = ? AND product_id = ?", newStatus, c.id, productId);
  });
}

export function withdrawPledge(c: CycleRow, productId: string, householdCode: string, nowSec: number): void {
  const p = product(productId);
  if (!p) throw errors.notFound();
  tx(() => {
    const cyc = cycle(c.id)!;
    const ln = line(c.id, productId);
    if (!ln) throw errors.notFound();
    const existing = all<PledgeRow>(
      "SELECT * FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?",
      c.id, productId, householdCode
    )[0];
    if (!existing) throw errors.notFound();
    if (!acceptingPledges(cyc, nowSec)) throw errors.cutoffPassed();
    run("DELETE FROM pledges WHERE id = ?", existing.id);
    run(
      "INSERT INTO pledge_events (cycle_id, product_id, household_code, delta_units, accepted_at) VALUES (?, ?, ?, ?, ?)",
      c.id, productId, householdCode, -existing.units, nowSec
    );
    bumpVersion(c.id, productId);
    run("UPDATE lines SET status = 'filling' WHERE cycle_id = ? AND product_id = ? AND status != 'dropped' AND status != 'taken_up'", c.id, productId);
  });
}

export interface ShareEntry {
  pledger: string;
  units: number;
  first_unit: number;
  share_cents: number;
}

/** Shares of a sealed or taken-up case, in pledge order. */
export function lineShares(c: CycleRow, productId: string): {
  price_cents: number;
  pack: number;
  unit_base_cents: number;
  remainder_cents: number;
  shares: ShareEntry[];
} {
  const p = product(productId)!;
  const pledges = pledgesOfLine(c.id, productId);
  const base = Math.floor(p.price_cents / p.pack);
  const remainder = p.price_cents - base * p.pack;
  const shares: ShareEntry[] = [];
  let index = 1;
  for (const pl of pledges) {
    let sum = 0;
    for (let i = 0; i < pl.units; i++) {
      sum += base + (index <= remainder ? 1 : 0);
      index += 1;
    }
    shares.push({
      pledger: pl.household_code,
      units: pl.units,
      first_unit: index - pl.units,
      share_cents: sum,
    });
  }
  return { price_cents: p.price_cents, pack: p.pack, unit_base_cents: base, remainder_cents: remainder, shares };
}
