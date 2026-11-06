// Outbound effects: emails, Kill Bill work. Each effect is recorded exactly
// once per business event and retried by the sweep while its dependency is
// down. A dependency outage never fails the action that triggered the effect.

import { pool, newId } from './db.js';
import { instantInZone, kitchenNow, KITCHEN_TZ } from './clock.js';
import { sendMail, MailUnavailable } from './mail.js';
import * as kb from './killbill.js';
import { KillBillUnavailable } from './killbill.js';
import { memberById } from './domain.js';
import type { Mail } from './mail.js';

// ---------------------------------------------------------------------------
// Emails: one per state change, deduplicated by a business key.
// ---------------------------------------------------------------------------

export async function queueEmail(mail: Mail, dedupeKey: string): Promise<void> {
  await pool.query(
    `INSERT INTO outbound_email (id, to_email, subject, body, dedupe_key, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [newId('eml'), mail.to, mail.subject, mail.body, dedupeKey, nowIso()],
  );
}

function nowIso(): string {
  return instantInZone(kitchenNow().epochMillis, KITCHEN_TZ);
}

export async function flushEmails(): Promise<void> {
  const pending = await pool.query(
    `SELECT id, to_email, subject, body FROM outbound_email WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50`,
  );
  for (const row of pending.rows as { id: string; to_email: string; subject: string; body: string }[]) {
    try {
      await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
      await pool.query(`UPDATE outbound_email SET status = 'sent' WHERE id = $1`, [row.id]);
    } catch (err) {
      if (!(err instanceof MailUnavailable)) {
        await pool.query(`UPDATE outbound_email SET status = 'failed' WHERE id = $1`, [row.id]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Product emails.
// ---------------------------------------------------------------------------

export async function sendBookingConfirmation(booking: {
  id: string;
  member_id: string;
  station_name: string;
  date: string;
  start: string;
  end: string;
  tail_end: string;
  prepaid_minutes: number;
  overage_amount: string;
  payment: string;
}): Promise<void> {
  const member = await memberById(booking.member_id);
  if (!member) return;
  const hours = (booking.prepaid_minutes / 60).toFixed(2);
  const lines = [
    `${booking.station_name} on ${booking.date}, ${booking.start}–${booking.end}.`,
    `Cleaning turnover until ${booking.tail_end}.`,
    `Prepaid hours used: ${hours}`,
    `Overage: $${booking.overage_amount}`,
  ];
  if (booking.payment === 'payment_pending') lines.push('Payment pending');
  await queueEmail(
    { to: member.contact_email, subject: `Booking confirmed: ${booking.station_name} on ${booking.date}`, body: lines.join('\n') },
    `booking-confirmed:${booking.id}`,
  );
}

export async function sendCancellationReceipt(booking: {
  id: string;
  member_id: string;
  station_name: string;
  date: string;
  prepaid_minutes: number;
  fee: { amount: string; status: string } | null;
}): Promise<void> {
  const member = await memberById(booking.member_id);
  if (!member) return;
  const hours = (booking.prepaid_minutes / 60).toFixed(2);
  const feeLine =
    booking.fee && booking.fee.status !== 'waived'
      ? `Late-cancellation fee: $${booking.fee.amount}`
      : 'No cancellation fee';
  await queueEmail(
    {
      to: member.contact_email,
      subject: `Booking cancelled: ${booking.station_name} on ${booking.date}`,
      body: [`Hours returned: ${hours}`, feeLine].join('\n'),
    },
    `booking-cancelled:${booking.id}`,
  );
}

export async function sendInvoiceNotice(memberId: string, amount: string, description: string): Promise<void> {
  const member = await memberById(memberId);
  if (!member) return;
  await queueEmail(
    {
      to: member.contact_email,
      subject: `Invoice notice: $${amount} for ${description}`,
      body: `$${amount} for ${description}.`,
    },
    `invoice-notice:${memberId}:${description}:${amount}`,
  );
}

export async function sendExpiryWarning(memberId: string, documentId: string, days: 14 | 3, label: string, expiresOn: string): Promise<void> {
  const member = await memberById(memberId);
  if (!member) return;
  await queueEmail(
    {
      to: member.contact_email,
      subject: `Certificate expires in ${days} days: ${label}`,
      body: `${label} expires on ${expiresOn}.`,
    },
    `expiry-warning:${documentId}:${days}`,
  );
}

// ---------------------------------------------------------------------------
// Expiry warnings: 14-day and 3-day, judged on the kitchen's today, sent once.
// ---------------------------------------------------------------------------

export async function runExpiryWarningChecks(today: string): Promise<void> {
  const docs = await pool.query(
    `SELECT id, member_id, kind, crew_cook_id, expires_on FROM documents WHERE status = 'approved'`,
  );
  for (const doc of docs.rows as { id: string; member_id: string; kind: string; crew_cook_id: string | null; expires_on: string }[]) {
    const days = daysUntil(today, doc.expires_on);
    let threshold: 14 | 3 | null = null;
    if (days <= 14 && days > 3) threshold = 14;
    else if (days <= 3 && days >= 0) threshold = 3;
    if (!threshold) continue;
    const already = await pool.query(
      `SELECT 1 FROM document_warnings WHERE document_id = $1 AND threshold = $2`,
      [doc.id, threshold],
    );
    if ((already.rowCount ?? 0) > 0) continue;
    // Record the intent first so a concurrent sweep cannot double-send.
    await pool.query(
      `INSERT INTO document_warnings (document_id, threshold) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [doc.id, threshold],
    );
    let label: string;
    if (doc.kind === 'liability_insurance') {
      label = 'Liability insurance';
    } else {
      const cook = doc.crew_cook_id ? await pool.query('SELECT name FROM users WHERE id = $1', [doc.crew_cook_id]) : null;
      label = `Food handler card – ${cook?.rows[0]?.name ?? 'crew cook'}`;
    }
    await sendExpiryWarning(doc.member_id, doc.id, threshold, label, doc.expires_on);
  }
}

function daysUntil(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// Kill Bill work: every charge, payment and credit is made once per business
// event, immediately when billing is up, queued when it is down.
// ---------------------------------------------------------------------------

export type BillingJob =
  | { kind: 'ensure_account'; member_id: string }
  | { kind: 'charge_and_pay'; member_id: string; description: string; amount_cents: number; booking_id: string }
  | { kind: 'charge_only'; member_id: string; description: string; amount_cents: number; booking_id: string }
  | { kind: 'credit'; member_id: string; description: string; amount_cents: number; booking_id: string };

export async function recordBilling(job: BillingJob): Promise<'recorded' | 'queued'> {
  try {
    await performBillingJob(job);
    return 'recorded';
  } catch (err) {
    if (err instanceof KillBillUnavailable || err instanceof Error) {
      await enqueueBilling(job);
      return 'queued';
    }
    throw err;
  }
}

async function enqueueBilling(job: BillingJob): Promise<void> {
  await pool.query(
    `INSERT INTO outbound_billing (id, kind, payload, status, created_at)
     VALUES ($1, $2, $3, 'pending', $4)
     ON CONFLICT (id) DO NOTHING`,
    [billingJobId(job), job.kind, JSON.stringify(job), nowIso()],
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

export async function performBillingJob(job: BillingJob): Promise<void> {
  const member = await memberById(job.member_id);
  if (!member) throw new Error(`unknown member ${job.member_id}`);
  const accountId = await kb.ensureAccount(job.member_id, member.business_name, member.contact_email);
  switch (job.kind) {
    case 'ensure_account':
      return;
    case 'charge_and_pay': {
      const invoiceId = await kb.chargeAndPay(accountId, job.description, job.amount_cents);
      void invoiceId;
      await sendInvoiceNotice(job.member_id, (job.amount_cents / 100).toFixed(2), job.description);
      return;
    }
    case 'charge_only':
      await kb.chargeOnly(accountId, job.description, job.amount_cents);
      await sendInvoiceNotice(job.member_id, (job.amount_cents / 100).toFixed(2), job.description);
      return;
    case 'credit':
      await kb.createCredit(accountId, job.description, job.amount_cents);
      return;
  }
}

/** Settles every queued billing job; called by the sweep when Kill Bill is up. */
export async function flushBillingQueue(): Promise<void> {
  const pending = await pool.query(
    `SELECT id, kind, payload FROM outbound_billing WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50`,
  );
  for (const row of pending.rows as { id: string; kind: string; payload: unknown }[]) {
    const job = row.payload as BillingJob;
    try {
      await performBillingJob(job);
      await pool.query(`UPDATE outbound_billing SET status = 'recorded' WHERE id = $1`, [row.id]);
    } catch (err) {
      if (!(err instanceof KillBillUnavailable)) {
        // Real Kill Bill rejection: drop the job so it never repeats.
        await pool.query(`UPDATE outbound_billing SET status = 'failed' WHERE id = $1`, [row.id]);
      }
    }
  }
}
