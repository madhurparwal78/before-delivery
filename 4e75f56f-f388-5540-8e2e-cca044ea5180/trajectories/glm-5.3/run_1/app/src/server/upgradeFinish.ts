import { query, withTransaction, withLedgerLock } from "./db.js";
import type { PaymentContext, BuyerRef } from "./payments.js";
import { queueMail } from "./mail.js";
import { renderReceiptPdf } from "./pdfs.js";
import { COURSE } from "./config.js";
import { offerBenchToWaitlist } from "./reservations.js";

/**
 * The upgrade completion, shared by the payment route and the retry job:
 * the reservation moves to its new bench only once the receipt is stored and
 * its email queued, freeing the old bench for the Bench-tier waitlist.
 */
export async function finishUpgrade(ctx: PaymentContext, reservationId: string, chargedCents: number, buyer: BuyerRef, billingName: string): Promise<boolean> {
  const { rows } = await query<{ bench: string; upgrade_bench: string | null; attendee_name: string | null }>(
    "SELECT bench, upgrade_bench, attendee_name FROM reservations WHERE id = $1",
    [reservationId]
  );
  const r = rows[0];
  if (!r || !r.upgrade_bench) return true;
  const key = `receipts/${reservationId}/upgrade.pdf`;
  try {
    const pdf = await renderReceiptPdf({
      heading: "Upgrade receipt",
      sub: `${COURSE.title} — ${COURSE.dates}`,
      lines: [{ bench: r.upgrade_bench, tier: "atelier", amountCents: chargedCents, attendeeName: r.attendee_name, note: "Atelier upgrade" }],
      totalCents: chargedCents,
      billingName,
    });
    await ctx.s3.put(key, pdf, "application/pdf");
  } catch {
    return false;
  }
  const { rows: docRows } = await query(
    "INSERT INTO documents (reservation_id, kind, object_key) VALUES ($1, 'upgrade-receipt', $2) ON CONFLICT (reservation_id, kind) DO NOTHING RETURNING reservation_id",
    [reservationId, key]
  );
  if (docRows.length > 0) {
    await queueMail(buyer.email, `Upgrade confirmed: Bench ${r.upgrade_bench} is Atelier`, `Your upgrade to Bench ${r.upgrade_bench} is confirmed. Your receipt is in your account: /account`);
  }
  const oldBench = r.bench;
  await withTransaction(async (client) => {
    const moved = await client.query(
      "UPDATE reservations SET bench = $2, tier = 'atelier', upgrade_bench = NULL, payment_pending = NULL, payment_in_flight = FALSE WHERE id = $1 AND upgrade_bench = $2",
      [reservationId, r.upgrade_bench]
    );
    if (moved.rowCount && moved.rowCount > 0) {
      const offered = await offerBenchToWaitlist(client, oldBench, ctx.cfg);
      if (offered) {
        await queueMail(offered.accountEmail, "A bench is open for you: sign in to accept", "A bench in your tier has opened at Opaline Bench Days. Sign in to your account to accept it within the offer window: /account");
      }
    }
  });
  return true;
}

export { finishUpgrade as finishUpgradePending };
