import type { PoolClient } from 'pg';

import type { AppContext } from '../http/context.js';
import { BillingUnavailable } from '../services/killbill.js';
import { enqueueEmail, invoiceNoticeEmail } from './emails.js';
import { findMember, type Queryable } from './kitchen.js';

export type BillingJobKind = 'overage' | 'fee_charge' | 'fee_credit' | 'overage_refund';

export interface BillingJobPayload {
  description: string;
  amount_cents: number;
}

export function overageChargeKey(bookingId: string): string {
  return `overage:${bookingId}`;
}

export function feeChargeKey(bookingId: string): string {
  return `fee:${bookingId}`;
}

/** Queues billing work for the retry loop to record once Kill Bill answers. */
export async function enqueueBillingJob(
  db: Queryable,
  job: {
    dedupeKey: string;
    kind: BillingJobKind;
    memberId: string;
    bookingId: string | null;
    payload: BillingJobPayload;
  },
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO billing_jobs (dedupe_key, kind, member_id, booking_id, payload, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [job.dedupeKey, job.kind, job.memberId, job.bookingId, JSON.stringify(job.payload), now],
  );
}

/** Drops a queued charge so it never reaches Kill Bill. */
export async function dropQueuedJob(db: Queryable, dedupeKey: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE billing_jobs SET status = 'dropped', completed_at = $2
      WHERE dedupe_key = $1 AND status = 'queued'`,
    [dedupeKey, now],
  );
}

/** Resolves the member's Kill Bill account, reusing one that already exists. */
export async function accountIdFor(
  db: Queryable,
  app: AppContext,
  memberId: string,
): Promise<string> {
  const cached = await db.query<{ account_id: string }>(
    'SELECT account_id FROM killbill_accounts WHERE member_id = $1',
    [memberId],
  );
  const existing = cached.rows[0]?.account_id;
  if (existing !== undefined) return existing;

  const member = await findMember(db, memberId);
  if (member === null) throw new Error(`unknown member ${memberId}`);
  const accountId = await app.killBill.ensureAccount({
    memberId: member.id,
    businessName: member.business_name,
    contactEmail: member.contact_email,
  });
  await db.query(
    `INSERT INTO killbill_accounts (member_id, account_id) VALUES ($1, $2)
     ON CONFLICT (member_id) DO NOTHING`,
    [memberId, accountId],
  );
  return accountId;
}

/** A charge immediately followed by its payment, as one business event. */
export async function chargeAndPay(
  db: Queryable,
  app: AppContext,
  memberId: string,
  description: string,
  amountCents: number,
): Promise<string> {
  const accountId = await accountIdFor(db, app, memberId);
  const invoiceId = await app.killBill.addExternalCharge(accountId, description, amountCents);
  await app.killBill.payInvoice(accountId, invoiceId, amountCents);
  return invoiceId;
}

interface BillingJobRow {
  id: string;
  dedupe_key: string;
  kind: BillingJobKind;
  member_id: string;
  booking_id: string | null;
  payload: BillingJobPayload;
}

interface BookingBillingRow {
  id: string;
  member_id: string;
  contact_email: string;
  payment: string;
  fee_status: string | null;
}

async function runJob(app: AppContext, job: BillingJobRow, now: Date): Promise<void> {
  await app.db.transaction(async (client: PoolClient) => {
    const claimed = await client.query<{ status: string }>(
      `SELECT status FROM billing_jobs WHERE id = $1 FOR UPDATE`,
      [job.id],
    );
    if (claimed.rows[0]?.status !== 'queued') return;

    let booking: BookingBillingRow | undefined;
    if (job.booking_id !== null) {
      const found = await client.query<BookingBillingRow>(
        `SELECT b.id, b.member_id, m.contact_email, b.payment, b.fee_status
           FROM bookings b JOIN members m ON m.id = b.member_id
          WHERE b.id = $1 FOR UPDATE OF b`,
        [job.booking_id],
      );
      booking = found.rows[0];
    }

    const finish = async (status: 'done' | 'dropped'): Promise<void> => {
      await client.query(
        `UPDATE billing_jobs SET status = $2, completed_at = $3 WHERE id = $1`,
        [job.id, status, now],
      );
    };

    const notify = async (): Promise<void> => {
      if (booking === undefined) return;
      const notice = invoiceNoticeEmail({
        chargeKey: job.dedupe_key,
        description: job.payload.description,
        amountCents: job.payload.amount_cents,
      });
      await enqueueEmail(client, notice.dedupeKey, booking.contact_email, notice.subject, notice.body, now);
    };

    switch (job.kind) {
      case 'overage': {
        if (booking === undefined || booking.payment !== 'payment_pending') {
          await finish('dropped');
          return;
        }
        await chargeAndPay(client, app, job.member_id, job.payload.description, job.payload.amount_cents);
        await client.query(`UPDATE bookings SET payment = 'paid' WHERE id = $1`, [booking.id]);
        await notify();
        await finish('done');
        return;
      }
      case 'fee_charge': {
        if (booking === undefined || booking.fee_status !== 'pending') {
          await finish('dropped');
          return;
        }
        const accountId = await accountIdFor(client, app, job.member_id);
        await app.killBill.addExternalCharge(
          accountId,
          job.payload.description,
          job.payload.amount_cents,
        );
        await client.query(`UPDATE bookings SET fee_status = 'charged' WHERE id = $1`, [booking.id]);
        await notify();
        await finish('done');
        return;
      }
      case 'fee_credit':
      case 'overage_refund': {
        const accountId = await accountIdFor(client, app, job.member_id);
        await app.killBill.addCredit(accountId, job.payload.description, job.payload.amount_cents);
        await finish('done');
        return;
      }
    }
  });
}

/**
 * Records everything still queued. Called by the background loop, so queued
 * work settles within 30 seconds of Kill Bill becoming reachable.
 */
export async function drainBillingQueue(app: AppContext, now: Date): Promise<void> {
  const queued = await app.db.query<BillingJobRow>(
    `SELECT id::text, dedupe_key, kind, member_id, booking_id, payload
       FROM billing_jobs WHERE status = 'queued' ORDER BY id LIMIT 50`,
  );
  for (const job of queued.rows) {
    try {
      await runJob(app, job, now);
      app.billing.markUp();
    } catch (error) {
      if (error instanceof BillingUnavailable) {
        app.billing.markDown();
        return;
      }
      throw error;
    }
  }
}
