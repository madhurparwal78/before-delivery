// Check-out: lateness, pack hours applied, overage priced at the rate resolved now, one invoice per booking.
import { pool, theRow, tx } from "./db.ts";
import { type AuthedCtx, type Reply } from "./router.ts";
import { Fields, idempotencyKey } from "./validate.ts";
import { bookingFor } from "./scope.ts";
import { availableQuarters, drawLots, lockMember, writeMovement, type ActorRef } from "./ledger.ts";
import { bookingRow, bookingView } from "./projections.ts";
import { claimKey, completeKey, withKey } from "./idempotency.ts";
import { transition } from "./transitions.ts";
import { lateQuarters, overageAmount } from "./pricing.ts";
import { rateFor } from "./rates.ts";
import { invoiceOverage, voidInvoice } from "./killbill.ts";
import { settle } from "./bookings.ts";
import { money } from "../shared/format.ts";

// POST /api/bookings/{id}/check-out
export async function checkOut(ctx: AuthedCtx): Promise<Reply> {
  const user = ctx.user;
  const found = await bookingFor(pool, user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  const key = idempotencyKey(ctx.req.headers["idempotency-key"], fields);
  if (key === undefined) {
    // A state conflict outranks the missing key in the API precedence.
    transition("check_out", (await bookingRow(pool, found.id)).status);
    return fields.reject();
  }
  const claim = await claimKey(user.id, key, JSON.stringify(["POST /api/bookings/check-out", found.id]));
  return withKey(claim, async (claimed) => {
    const at = await settle(found.member_id);
    let committedInvoice: string | null = null;
    try {
      return await tx(async (db) => {
      await lockMember(db, found.member_id, at);
      const b = await bookingRow(db, found.id);
      const next = transition("check_out", b.status);
      fields.raise();
      const actor: ActorRef = { userId: user.id, name: user.name, role: "kitchen_manager" };
      const late = lateQuarters(b.end_at.getTime(), at);
      const applied = Math.min(late, await availableQuarters(db, b.member_id));
      await writeMovement(db, { memberId: b.member_id, kind: "usage", quarters: b.quarters, actor, at, bookingId: b.id, lots: [] });
      if (applied > 0) {
        await writeMovement(db, {
          memberId: b.member_id,
          kind: "late_checkout",
          quarters: applied,
          actor,
          at,
          bookingId: b.id,
          lots: await drawLots(db, b.member_id, applied),
        });
      }
      const overageQuarters = late - applied;
      let overage: { rate: number; tax: string; subtotal: number; taxCents: number; total: number; invoiceId: string | null } | null = null;
      if (overageQuarters > 0) {
        const rate = await rateFor(db, b.site_id, b.date);
        if (!rate) throw new Error(`no rate covers ${b.date} at site ${b.site_id}`);
        const amount = overageAmount(overageQuarters, rate.hourly_rate_cents, rate.tax_rate_percent);
        let invoiceId: string | null = null;
        if (amount.total > 0) {
          const member = await theRow<{ business_name: string; email: string }>(
            db,
            "SELECT m.business_name, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.id = $1",
            [b.member_id],
          );
          invoiceId = await invoiceOverage(
            { id: b.member_id, businessName: member.business_name, email: member.email },
            b.reference,
            amount.total,
            `Overage ${b.reference}: ${overageQuarters} quarter hours at $${money(rate.hourly_rate_cents)}/h plus ${rate.tax_rate_percent}% tax`,
          );
          committedInvoice = invoiceId;
        }
        overage = { rate: rate.hourly_rate_cents, tax: rate.tax_rate_percent, subtotal: amount.subtotal, taxCents: amount.tax, total: amount.total, invoiceId };
      }
      await db.query(
        `UPDATE bookings SET status = $2, checked_out_at = $3, checked_out_by_id = $4, checked_out_by_name = $5,
           late_quarter_hours = $6, pack_quarters_applied = $7,
           overage_quarter_hours = $8, overage_hourly_rate_cents = $9, overage_tax_rate_percent = $10,
           overage_subtotal_cents = $11, overage_tax_cents = $12, overage_total_cents = $13, overage_killbill_invoice_id = $14
         WHERE id = $1`,
        [
          b.id,
          next,
          new Date(at),
          user.id,
          user.name,
          late,
          applied,
          overage ? overageQuarters : null,
          overage?.rate ?? null,
          overage?.tax ?? null,
          overage?.subtotal ?? null,
          overage?.taxCents ?? null,
          overage?.total ?? null,
          overage?.invoiceId ?? null,
        ],
      );
      return completeKey(db, claimed, 200, { booking: await bookingView(db, b.id) });
      }, { retry: false });
    } catch (error) {
      if (committedInvoice !== null) await voidInvoice(committedInvoice);
      throw error;
    }
  });
}
