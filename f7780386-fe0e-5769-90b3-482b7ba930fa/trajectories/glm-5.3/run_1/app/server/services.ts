// Service state: billing reachability, the billing queue and the sweeps that
// settle everything within 30 seconds of a dependency returning, without a
// restart.

import { pool } from './db.js';
import { kitchenNow } from './clock.js';
import * as kb from './killbill.js';
import { flushEmails, performBillingJob, queueEmail, sendBookingConfirmation, sendCancellationReceipt, runExpiryWarningChecks, flushBillingQueue, type BillingJob } from './outbound.js';
import { KITCHEN_NAME, KITCHEN_TIME_ZONE } from '../shared/seed.js';

// ---------------------------------------------------------------------------
// Billing reachability, probed at least every 15 seconds.
// ---------------------------------------------------------------------------

let billingUpDown: 'up' | 'down' = 'down';
let lastProbe = 0;
let probing = false;

export function billingUp(): boolean {
  const now = kitchenNow().epochMillis;
  if (now - lastProbe > 15000 && !probing) {
    probing = true;
    void probeBilling().finally(() => {
      probing = false;
    });
  }
  return billingUpDown === 'up';
}

async function probeBilling(): Promise<void> {
  lastProbe = kitchenNow().epochMillis;
  try {
    await kb.probe();
    if (billingUpDown === 'down') {
      billingUpDown = 'up';
      await settlePendingBilling();
    }
  } catch {
    billingUpDown = 'down';
  }
}

/** Records a billing job now, or queues it while Kill Bill is unreachable. */
export async function recordBilling(job: BillingJob): Promise<'recorded' | 'queued'> {
  try {
    await performBillingJob(job);
    return 'recorded';
  } catch {
    await enqueueBilling(job);
    return 'queued';
  }
}

async function enqueueBilling(job: BillingJob): Promise<void> {
  await pool.query(
    `INSERT INTO outbound_billing (id, kind, payload, status, created_at)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT (id) DO NOTHING`,
    [billingJobId(job), job.kind, JSON.stringify(job), new Date(kitchenNow().epochMillis)],
  );
}

export function billingJobId(job: BillingJob): string {
  switch (job.kind) {
    case 'ensure_account':
      return `ensure-account:${job.member_id}`;
    case 'charge_and_pay':
      return `charge-and-pay:${job.booking_id}`;
    case 'charge_only':
      return `charge-only:${job.booking_id}`;
    case 'credit':
      return `credit:${job.booking_id}:${job.description}`;
  }
}

/** Drops a still-pending queued job, e.g. a fee waived before it was charged. */
export async function dropBillingJob(jobId: string): Promise<void> {
  await pool.query(`UPDATE outbound_billing SET status = 'dropped' WHERE id = $1 AND status = 'pending'`, [jobId]);
}

/** Called when Kill Bill returns: settle the queue, turn bookings paid. */
export async function settlePendingBilling(): Promise<void> {
  await flushBillingQueue();
  const pending = await pool.query(`SELECT id FROM bookings WHERE payment = 'payment_pending'`);
  for (const row of pending.rows as { id: string }[]) {
    const job = await pool.query(`SELECT status FROM outbound_billing WHERE id = $1`, [`charge-and-pay:${row.id}`]);
    const status = (job.rows[0] as { status: string } | undefined)?.status;
    if (status === 'recorded') {
      await pool.query(`UPDATE bookings SET payment = 'paid' WHERE id = $1 AND payment = 'payment_pending'`, [row.id]);
    }
  }
  const fees = await pool.query(`SELECT id FROM bookings WHERE fee_status = 'pending'`);
  for (const row of fees.rows as { id: string }[]) {
    const job = await pool.query(`SELECT status FROM outbound_billing WHERE id = $1`, [`charge-only:${row.id}`]);
    const status = (job.rows[0] as { status: string } | undefined)?.status;
    if (status === 'recorded') {
      await pool.query(`UPDATE bookings SET fee_status = 'charged' WHERE id = $1 AND fee_status = 'pending'`, [row.id]);
    }
  }
}

// ---------------------------------------------------------------------------
// The sweep: expired holds, completed bookings, packet expiry, billing,
// emails and expiry warnings, at least every 15 seconds.
// ---------------------------------------------------------------------------

export async function sweep(): Promise<void> {
  const now = kitchenNow();
  const nowDate = new Date(now.epochMillis);
  await pool
    .query(`UPDATE holds SET status = 'expired' WHERE status = 'live' AND expires_at <= $1`, [nowDate])
    .catch(() => undefined);
  // checked_in → completed once now is at or after the booking's end.
  await pool
    .query(
      `UPDATE bookings SET status = 'completed'
       WHERE status = 'checked_in' AND date < $1 OR (status = 'checked_in' AND date = $1 AND end_min <= $2)`,
      [now.today, now.minutes],
    )
    .catch(() => undefined);
  await pool
    .query(`UPDATE packets SET status = 'expired' WHERE status = 'active' AND expires_at <= $1`, [nowDate])
    .catch(() => undefined);
  await probeBilling().catch(() => undefined);
  if (billingUpDown === 'up') {
    await settlePendingBilling().catch(() => undefined);
  }
  await flushEmails().catch(() => undefined);
  await runExpiryWarningChecks(now.today).catch(() => undefined);
}

export { sendBookingConfirmation, sendCancellationReceipt, queueEmail };

export const kitchenName = KITCHEN_NAME;
export const kitchenTimeZone = KITCHEN_TIME_ZONE;
