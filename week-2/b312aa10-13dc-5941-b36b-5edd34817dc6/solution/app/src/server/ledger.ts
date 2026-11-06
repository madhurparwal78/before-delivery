// The hour ledger and its Kill Bill pairs, and the hour bank derived from them.

import type pg from "pg";
import type { Db } from "./db.js";
import { hoursText } from "../shared/format.js";
import { monthName, type Month } from "../shared/time.js";

type ItemKind = "Booking" | "Moved" | "Late cancellation" | "Cancelled" | "Waived late cancellation" | "Adjustment";

/** Sign of the money and, for kinds that carry hours, of the hours. Fees and waivers carry none. */
const ITEM_RULES: Record<ItemKind, { money: 1 | -1; hours: 1 | -1 | null }> = {
  Booking: { money: 1, hours: 1 },
  Moved: { money: -1, hours: -1 },
  "Late cancellation": { money: 1, hours: null },
  Cancelled: { money: -1, hours: -1 },
  "Waived late cancellation": { money: -1, hours: null },
  Adjustment: { money: -1, hours: null },
};

export interface ItemSubject { kitchenId: string; memberId: string; bookingId: string }

/** The Kill Bill description: a booking charge names its block, an adjustment the fee's closed month. */
function describe(kind: ItemKind, bookingId: string, detail: string | undefined): string {
  if (kind === "Booking") return `Booking ${bookingId} ${detail}`;
  if (kind === "Adjustment") return `Adjustment: waived late cancellation ${bookingId} (${detail})`;
  return `${kind} ${bookingId}`;
}

/**
 * Writes one Kill Bill item to the outbox and, for the kinds that move hours, its hour-ledger
 * entry, in the caller's transaction and in the same kitchen-local month. `detail` is the block
 * label of a booking charge or the closed month name of an adjustment.
 */
export async function postItem(
  client: pg.PoolClient, subject: ItemSubject, kind: ItemKind, month: Month,
  amountCents: number, quarters: number, detail?: string,
): Promise<void> {
  const rule = ITEM_RULES[kind];
  const description = describe(kind, subject.bookingId, detail);
  const { rows } = await client.query(
    `INSERT INTO billing_items (kitchen_id, member_id, booking_id, month, kind, description, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [subject.kitchenId, subject.memberId, subject.bookingId, month, kind, description, rule.money * amountCents],
  );
  if (rule.hours !== null) {
    await client.query(
      "INSERT INTO hour_ledger (billing_item_id, member_id, month, quarters) VALUES ($1, $2, $3, $4)",
      [rows[0].id, subject.memberId, month, rule.hours * quarters],
    );
  }
}

interface HourBank { month: Month; allowanceHours: number; usedHours: number; balanceHours: number }

/** Balance in quarter hours: the plan allowance minus that month's ledger. */
export async function balanceQuarters(db: Db, memberId: string, month: Month): Promise<{ allowance: number; used: number; balance: number }> {
  const { rows } = await db.query(
    `SELECT m.plan_hours * 4 AS allowance, COALESCE((SELECT sum(quarters) FROM hour_ledger l WHERE l.member_id = m.id AND l.month = $2), 0)::int AS used
     FROM members m WHERE m.id = $1`,
    [memberId, month],
  );
  const { allowance, used } = rows[0] as { allowance: number; used: number };
  return { allowance, used, balance: allowance - used };
}

export async function hourBank(db: Db, memberId: string, month: Month): Promise<HourBank> {
  const q = await balanceQuarters(db, memberId, month);
  return { month, allowanceHours: q.allowance / 4, usedHours: q.used / 4, balanceHours: q.balance / 4 };
}

/**
 * The hour check for a hold, confirm or move: each month's need against that month's balance,
 * with `returned` quarters credited back first (a move's old block). Names the earliest month short.
 */
export async function hoursShortfall(db: Db, memberId: string, needs: Map<Month, number>, returned?: { month: Month; quarters: number }): Promise<string | null> {
  for (const month of [...needs.keys()].sort()) {
    const need = needs.get(month)!;
    const { balance } = await balanceQuarters(db, memberId, month);
    const available = balance + (returned && returned.month === month ? returned.quarters : 0);
    if (need > available) return `That needs ${hoursText(need)} hours; you have ${hoursText(available)} left for ${monthName(month)}.`;
  }
  return null;
}
