import type { Window } from "../shared/api";
import { config } from "./config";
import { warrantyYears } from "./catalogue";
import { rows, type Queryable } from "./db";
import { hasCabinFit } from "../shared/cabin";

// Return, trial and warranty windows: every deadline is decided here, on server time.

const DAY_MS = 24 * 3600 * 1000;

export function returnEnd(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + config.returnWindowDays * DAY_MS);
}

export function trialEnd(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + config.trialWindowDays * DAY_MS);
}

/** Luggage, backpacks and totes carry a trial; wallets and accessories do not. */
export function hasTrial(category: string): boolean {
  return hasCabinFit(category);
}

/** Cover runs for the category's years, counted in calendar years from delivery. */
export function warrantyEnd(deliveredAt: Date, category: string): Date {
  const end = new Date(deliveredAt);
  end.setUTCFullYear(end.getUTCFullYear() + warrantyYears(category));
  return end;
}

/** The window as the order body publishes it. Open while server now is before the end. */
export function windowState(end: Date | null, now: Date): Window {
  if (!end) return { ends_at: null, seconds_left: 0, open: false };
  const left = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
  return { ends_at: end.toISOString(), seconds_left: left, open: now < end };
}

export interface LineFacts {
  quantity: number;
  category: string;
  delivered: boolean;
  deliveredAt: Date | null;
  /** An open return or trial blocks a new one. */
  openCase: boolean;
  /** Units already covered by returns that were not rejected. */
  returned: number;
  trialRefunded: boolean;
}

type Verdict = { ok: true } | { ok: false; closedOn: Date | null };

const NOT_ELIGIBLE: Verdict = { ok: false, closedOn: null };

/** Units a return can still ask for. */
function returnable(f: LineFacts): number {
  return f.trialRefunded ? 0 : f.quantity - f.returned;
}

/** A delivered line can be returned while server now is before delivery + the return window and units remain. */
export function returnVerdict(f: LineFacts, quantity: number, now: Date): Verdict {
  if (!f.delivered || !f.deliveredAt) return NOT_ELIGIBLE;
  const end = returnEnd(f.deliveredAt);
  if (now >= end) return { ok: false, closedOn: end };
  return quantity >= 1 && quantity <= returnable(f) ? { ok: true } : NOT_ELIGIBLE;
}

/** Luggage, backpacks and totes can be sent back from trial while server now is before delivery + the trial window. */
export function trialVerdict(f: LineFacts, now: Date): Verdict {
  if (!f.delivered || !f.deliveredAt || !hasTrial(f.category) || f.returned > 0 || f.trialRefunded) return NOT_ELIGIBLE;
  const end = trialEnd(f.deliveredAt);
  return now >= end ? { ok: false, closedOn: end } : { ok: true };
}

interface FactsRow {
  line_id: string;
  open_case: boolean;
  returned: number;
  trial_refunded: boolean;
}

/** What the cases on each line say about further returns and trials. */
export async function lineFactsFor(db: Queryable, lineIds: string[]): Promise<Map<string, Pick<LineFacts, "openCase" | "returned" | "trialRefunded">>> {
  const found = await rows<FactsRow>(
    db,
    `SELECT l.id AS line_id,
            EXISTS (SELECT 1 FROM cases c WHERE c.order_line_id = l.id AND c.kind IN ('return', 'trial') AND c.status NOT IN ('rejected', 'refunded', 'exchanged')) AS open_case,
            coalesce((SELECT sum(c.quantity) FROM cases c WHERE c.order_line_id = l.id AND c.kind = 'return' AND c.status <> 'rejected'), 0) AS returned,
            EXISTS (SELECT 1 FROM cases c WHERE c.order_line_id = l.id AND c.kind = 'trial' AND c.status = 'refunded') AS trial_refunded
     FROM order_lines l WHERE l.id = ANY($1)`,
    [lineIds],
  );
  return new Map(found.map((r) => [r.line_id, { openCase: r.open_case, returned: r.returned, trialRefunded: r.trial_refunded }]));
}
