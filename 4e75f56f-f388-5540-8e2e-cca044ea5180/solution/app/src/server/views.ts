import { lockLedger, many, one, pool, tx, type Queryable } from "./db.js";
import { sweep } from "./ledger.js";
import { notFound } from "./http.js";
import { reservationView, reservationsWhere } from "./reservations.js";

/** Runs the expiry sweep when anything is due, so no read ever reports an expired hold or offer. */
export async function freshLedger(now: Date): Promise<void> {
  const due = await one<{ due: boolean }>(
    pool,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE state = 'held' AND hold_expires_at <= $1 AND payment_pending IS NULL)
         OR EXISTS (SELECT 1 FROM waitlist_entries WHERE state = 'offered' AND offer_expires_at <= $1) AS due`,
    [now],
  );
  if (!due?.due) return;
  await tx(async (db) => {
    await lockLedger(db);
    await sweep(db, now);
  });
}

export async function groupView(db: Queryable, groupId: string, now: Date) {
  const rows = await reservationsWhere(db, "r.group_id = $1", [groupId]);
  if (!rows.length) throw notFound();
  const payment = await one<{ id: string; kb_invoice_id: string | null }>(
    db,
    "SELECT id, kb_invoice_id FROM payments WHERE owner_id = $1 AND kind = 'group' AND confirmed_at IS NOT NULL",
    [groupId],
  );
  const items = payment
    ? await many<{ bench: string; amount_cents: number }>(
        db,
        `SELECT pi.bench, pi.amount_cents - COALESCE((SELECT sum(f.amount_cents) FROM refunds f
                 WHERE f.payment_id = pi.payment_id AND f.reservation_id = pi.reservation_id AND f.confirmed_at IS NOT NULL), 0)::bigint AS amount_cents
         FROM payment_items pi WHERE pi.payment_id = $1 ORDER BY pi.bench`,
        [payment.id],
      )
    : [];
  const state = rows.some((row) => row.state === "held") ? "held" : rows.every((row) => row.state === "released") ? "released" : "paid_in_full";
  return {
    id: groupId,
    state,
    reservations: rows.map((row) => reservationView(row, now)),
    invoice: payment
      ? { kb_invoice_id: payment.kb_invoice_id, items, total_cents: items.reduce((sum, item) => sum + item.amount_cents, 0) }
      : null,
  };
}
