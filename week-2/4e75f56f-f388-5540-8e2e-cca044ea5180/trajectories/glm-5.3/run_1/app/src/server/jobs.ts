import type { Config } from "./config.js";
import { query, withTransaction, withLedgerLock } from "./db.js";
import { queueMail, sendQueuedMail } from "./mail.js";
import type { PaymentContext } from "./payments.js";
import { finishSeatReceipt, finishGroupInvoice, type GroupSeat } from "./payments.js";
import { fetchReservation, fetchReservationClient, offerBenchToWaitlist } from "./reservations.js";
import { venueDate, remindersDue } from "./time.js";
import { finishUpgradePending } from "./upgradeFinish.js";

/**
 * Every piece of background work is claimed in the database, so it runs
 * exactly once across all app processes sharing the database.
 */
export class Jobs {
  private timers: NodeJS.Timeout[] = [];

  constructor(private cfg: Config, private ctx: PaymentContext) {}

  start(): void {
    this.every(1, () => this.releaseExpiredHolds());
    this.every(1, () => this.expireOffers());
    this.every(30, () => this.sendReminders());
    this.every(10, () => this.retryPendingReceipts());
    this.every(10, () => sendQueuedMail(this.cfg));
    this.every(30, () => this.ensureSeed());
  }

  /** The staff accounts and content seeds are re-applied when missing. */
  private async ensureSeed(): Promise<void> {
    const { seed } = await import("./seed.js");
    const pb = new (await import("./pocketbase.js")).PocketBase(this.cfg);
    await seed(this.cfg, pb).catch(() => undefined);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private every(seconds: number, fn: () => Promise<void>): void {
    const t = setInterval(() => {
      fn().catch(() => undefined);
    }, seconds * 1000);
    t.unref?.();
    this.timers.push(t);
  }

  /** Within 2 seconds of expiry, the server releases the bench and offers it. */
  private async releaseExpiredHolds(): Promise<void> {
    const now = Date.now();
    const { rows } = await query<{ id: string; bench: string }>(
      `SELECT id, bench FROM reservations
       WHERE state = 'held' AND hold_expires_at < now() - interval '0 seconds'
         AND payment_in_flight = FALSE AND payment_pending IS NULL
       ORDER BY hold_expires_at
       LIMIT 20`
    );
    for (const r of rows) {
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const fresh = await fetchReservationClient(client, r.id);
          if (!fresh || fresh.state !== "held" || fresh.payment_in_flight || fresh.payment_pending) {
            return { released: false };
          }
          if (!fresh.hold_expires_at || fresh.hold_expires_at.getTime() > now) {
            return { released: false };
          }
          await client.query("UPDATE reservations SET state = 'released' WHERE id = $1 AND state = 'held'", [r.id]);
          const offered = await offerBenchToWaitlist(client, fresh.bench, this.cfg);
          return { released: true, offered };
        });
      });
      if (outcome.offered) {
        await queueMail(outcome.offered.accountEmail, "A bench is open for you: sign in to accept", "A bench in your tier has opened at Opaline Bench Days. Sign in to your account to accept it within the offer window: /account");
      }
    }
  }

  /** Offers that lapse pass to the next waitlisted entry, or open the bench. */
  private async expireOffers(): Promise<void> {
    const { rows } = await query<{ id: string; bench: string }>(
      `SELECT id, bench FROM waitlist
       WHERE state = 'offered' AND offer_expires_at < now()
       ORDER BY offer_expires_at
       LIMIT 20`
    );
    for (const offer of rows) {
      const outcome = await withTransaction(async (client) => {
        return withLedgerLock(client, async () => {
          const { rows: fresh } = await client.query(
            "SELECT id, state, bench FROM waitlist WHERE id = $1",
            [offer.id]
          );
          const o = fresh[0];
          if (!o || o.state !== "offered") return { acted: false };
          await client.query("UPDATE waitlist SET state = 'offer_lapsed' WHERE id = $1", [offer.id]);
          const offered = o.bench ? await offerBenchToWaitlist(client, o.bench, this.cfg) : null;
          return { acted: true, offered };
        });
      });
      if (outcome.offered) {
        await queueMail(outcome.offered.accountEmail, "A bench is open for you: sign in to accept", "A bench in your tier has opened at Opaline Bench Days. Sign in to your account to accept it within the offer window: /account");
      }
    }
  }

  /**
   * Balance reminders at most once each, to the buyer, on or after the due
   * venue-local dates. If both are due at once, only the 7-day reminder goes
   * out and the 21-day reminder never follows.
   */
  private async sendReminders(): Promise<void> {
    const due = remindersDue(venueDate(this.cfg.benchDaysNow));
    if (due.length === 0) return;
    const seven = due.includes("7");
    const { rows } = await query<{ id: string; bench: string }>(
      seven
        ? `SELECT id, bench FROM reservations WHERE state = 'deposit_paid' AND reminder_7_sent_at IS NULL LIMIT 50`
        : `SELECT id, bench FROM reservations WHERE state = 'deposit_paid' AND reminder_21_sent_at IS NULL LIMIT 50`
    );
    for (const r of rows) {
      const reservation = await fetchReservation(r.id);
      if (!reservation) continue;
      const buyer = await buyerOf(reservation.buyer_id);
      if (seven) {
        const { rowCount } = await query(
          "UPDATE reservations SET reminder_7_sent_at = now() WHERE id = $1 AND reminder_7_sent_at IS NULL",
          [r.id]
        );
        if (rowCount) {
          await queueMail(buyer.email, `Balance reminder: 7 days to pay for Bench ${reservation.bench}`, `Your balance for Bench ${reservation.bench} is due by 19 March 2027. Pay it from your account: /account`);
          // The 21-day reminder never follows when both were due at once.
          await query("UPDATE reservations SET reminder_21_sent_at = now() WHERE id = $1 AND reminder_21_sent_at IS NULL", [r.id]);
        }
      } else {
        const { rowCount } = await query(
          "UPDATE reservations SET reminder_21_sent_at = now() WHERE id = $1 AND reminder_21_sent_at IS NULL",
          [r.id]
        );
        if (rowCount) {
          await queueMail(buyer.email, `Balance reminder: 21 days to pay for Bench ${reservation.bench}`, `Your balance for Bench ${reservation.bench} is due by 19 March 2027. Pay it from your account: /account`);
        }
      }
    }
  }

  /**
   * Finishes payments Kill Bill confirmed but whose receipt could not be
   * stored: deposit, balance, full, upgrade and group checkout.
   */
  private async retryPendingReceipts(): Promise<void> {
    const { rows } = await query<{ id: string; payment_pending: string; group_id: string | null; buyer_id: string }>(
      `SELECT id, payment_pending, group_id, buyer_id FROM reservations
       WHERE payment_pending IS NOT NULL AND payment_in_flight = FALSE
       LIMIT 20`
    );
    const seenGroups = new Set<string>();
    for (const r of rows) {
      // Only a payment Kill Bill confirmed may be finished; a stale marker
      // from a request that never reached Kill Bill is cleared instead.
      const invoiceKey = r.payment_pending === "group"
        ? `ob-group-${r.group_id}`
        : `ob-${r.payment_pending}-${r.id}`;
      const { rows: confirmed } = await query<{ confirmed_at: Date | null }>(
        "SELECT confirmed_at FROM kb_invoices WHERE external_key = $1",
        [invoiceKey]
      );
      if (!confirmed[0]?.confirmed_at) {
        await query(
          "UPDATE reservations SET payment_pending = NULL WHERE id = $1 AND payment_pending = $2 AND payment_in_flight = FALSE",
          [r.id, r.payment_pending]
        );
        continue;
      }
      const reservation = await fetchReservation(r.id);
      if (!reservation || !reservation.payment_pending) continue;
      const buyer = await buyerOf(reservation.buyer_id);
      const buyerRef = { id: reservation.buyer_id, name: buyer.name, email: buyer.email };
      const kind = reservation.payment_pending as "deposit" | "balance" | "full" | "upgrade" | "group";
      if (kind === "group") {
        if (r.group_id && !seenGroups.has(r.group_id)) {
          seenGroups.add(r.group_id);
          await this.finishGroupPending(r.group_id, buyerRef);
        }
        continue;
      }
      if (kind === "upgrade") {
        const charged = await chargedForKind(r.id, "upgrade");
        await finishUpgradePending(this.ctx, reservation.id, charged, buyerRef, buyer.name);
        continue;
      }
      const charged = await chargedForKind(r.id, kind);
      const stored = await finishSeatReceipt(this.ctx, r.id, kind, charged, buyerRef, buyer.name);
      void stored;
    }
  }

  private async finishGroupPending(groupId: string, buyerRef: { id: string; name: string; email: string }): Promise<void> {
    const { rows } = await query<{ id: string; bench: string; tier: string; price_cents: number; attendee_name: string | null }>(
      "SELECT id, bench, tier, price_cents, attendee_name FROM reservations WHERE group_id = $1 ORDER BY bench",
      [groupId]
    );
    const seats: GroupSeat[] = rows.map((s) => ({
      reservationId: s.id,
      bench: s.bench,
      tier: s.tier,
      amountCents: s.price_cents,
      attendeeName: s.attendee_name,
    }));
    await finishGroupInvoice(this.ctx, groupId, buyerRef, seats, buyerRef.name);
  }

}

async function buyerOf(buyerId: string): Promise<{ name: string; email: string }> {
  const { rows } = await query<{ name: string; email: string }>("SELECT name, email FROM accounts WHERE id = $1", [buyerId]);
  return rows[0] ?? { name: "", email: "" };
}

async function chargedForKind(reservationId: string, kind: string): Promise<number> {
  const { rows } = await query<{ amount_cents: number }>(
    "SELECT amount_cents FROM kb_payments WHERE reservation_id = $1 AND kind = $2 AND confirmed_at IS NOT NULL LIMIT 1",
    [reservationId, kind]
  );
  return rows[0]?.amount_cents ?? 0;
}
