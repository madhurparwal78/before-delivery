// Spendable credit: the household's balance minus its pledge holds on cycles that are not closed.
import { all } from "./db.js";
import { balanceOf } from "./ledger.js";

interface Credit {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
}

/** What one pledged unit holds: the case price over the pack, rounded up to a whole cent. */
export function unitHoldCents(priceCents: number, pack: number): number {
  return Math.ceil(priceCents / pack);
}

function heldCents(code: string): number {
  const held = all<{ units: number; price_cents: number; pack: number }>(
    `SELECT p.units, pr.price_cents, pr.pack
     FROM pledges p
     JOIN lines l ON l.cycle_id = p.cycle_id AND l.product_id = p.product_id
     JOIN cycles c ON c.id = p.cycle_id
     JOIN products pr ON pr.id = p.product_id
     WHERE p.pledger = ? AND c.status <> 'closed' AND l.status <> 'dropped'`,
    code,
  );
  return held.reduce((sum, p) => sum + p.units * unitHoldCents(p.price_cents, p.pack), 0);
}

export function creditOf(code: string): Credit {
  const balance = balanceOf(code);
  const held = heldCents(code);
  return { balance_cents: balance, held_cents: held, spendable_cents: balance - held };
}
