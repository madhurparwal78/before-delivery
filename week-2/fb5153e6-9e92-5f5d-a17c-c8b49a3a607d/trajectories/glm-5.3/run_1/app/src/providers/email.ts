import { query, one } from '../db/db.js';
import { config } from '../config.js';
import { sendEmail } from '../providers/mail.js';
import { formatAmount, formatDate, t, type Locale } from '../locales.js';
import { planLabel, type PlanId } from '../domain/plans.js';
import { markService } from '../providers/availability.js';

export interface ReceiptEmail {
  kind: 'receipt';
  order: { ref: string; email: string; locale: Locale; licence: string; amountCents: number; editionNumber: number | null; editionTotal: number | null; modelTitle: string; receiptToken: string };
}

export interface RefundEmail {
  kind: 'refund';
  order: { ref: string; email: string; locale: Locale; refundCents: number };
}

export interface PlanChangeEmail {
  kind: 'plan_downgrade' | 'plan_upgrade';
  plan: PlanId;
  effectiveDate: string | null;
  chargedCents: number | null;
  authorEmail: string;
}

export type PendingEmail = ReceiptEmail | RefundEmail | PlanChangeEmail;

/** Emails are queued and sent once, only after Kill Bill confirms; failures retry on the queue schedule. */
export async function queueEmail(email: PendingEmail): Promise<void> {
  await query('INSERT INTO pending_emails (kind, payload) VALUES ($1, $2)', [email.kind, JSON.stringify(email)]);
}

export async function flushEmails(retrySeconds: number[]): Promise<void> {
  const rows = await query<{ id: number; kind: string; payload: PendingEmail; attempts: number }>(
    `SELECT id, kind, payload, attempts FROM pending_emails WHERE next_attempt_at <= now() ORDER BY id LIMIT 10`,
  );
  for (const row of rows.rows) {
    try {
      await deliver(row.kind, row.payload);
      await query('DELETE FROM pending_emails WHERE id = $1', [row.id]);
    } catch {
      const attempts = row.attempts + 1;
      const delay = retrySeconds[Math.min(attempts - 1, retrySeconds.length - 1)] ?? 600;
      if (attempts >= retrySeconds.length + 1) {
        await query('DELETE FROM pending_emails WHERE id = $1', [row.id]);
      } else {
        await query(
          'UPDATE pending_emails SET attempts = $2, next_attempt_at = now() + make_interval(secs => $3::double precision) WHERE id = $1',
          [row.id, attempts, delay],
        );
      }
      markService('mail', false);
    }
  }
}

async function deliver(kind: string, payload: PendingEmail): Promise<void> {
  if (kind === 'receipt' && payload.kind === 'receipt') {
    const order = payload.order;
    const locale = order.locale;
    const lines = [t(locale, 'receipt.total', { amount: formatAmount(order.amountCents, locale) }), order.licence];
    if (order.editionNumber !== null && order.editionTotal !== null) {
      lines.push(t(locale, 'receipt.edition_line', { n: order.editionNumber, total: order.editionTotal }));
    }
    lines.push(`${config.publicUrl}/receipts/${order.receiptToken}`);
    await sendEmail({
      to: order.email,
      locale,
      subject: t(locale, 'mail.receipt_subject', { ref: order.ref }),
      text: lines.join('\n'),
    });
    return;
  }
  if (kind === 'refund' && payload.kind === 'refund') {
    const order = payload.order;
    await sendEmail({
      to: order.email,
      locale: order.locale,
      subject: t(order.locale, 'mail.refund_subject', { ref: order.ref }),
      text: t(order.locale, 'receipt.refunded_line', { amount: formatAmount(order.refundCents, order.locale) }),
    });
    return;
  }
  if (payload.kind === 'plan_downgrade' || payload.kind === 'plan_upgrade') {
    if (payload.kind === 'plan_downgrade') {
      await sendEmail({
        to: payload.authorEmail,
        locale: 'en',
        subject: t('en', 'mail.plan_downgrade_subject', { plan: planLabel(payload.plan), date: formatDate(new Date(`${payload.effectiveDate}T00:00:00Z`), 'en') }),
        text: t('en', 'mail.plan_downgrade_subject', { plan: planLabel(payload.plan), date: formatDate(new Date(`${payload.effectiveDate}T00:00:00Z`), 'en') }),
      });
    } else {
      await sendEmail({
        to: payload.authorEmail,
        locale: 'en',
        subject: t('en', 'mail.plan_upgrade_subject', { plan: planLabel(payload.plan) }),
        text: t('en', 'mail.plan_upgrade_body', { plan: planLabel(payload.plan), amount: formatAmount(payload.chargedCents ?? 0, 'en') }),
      });
    }
  }
}

export async function emailBacklog(): Promise<number> {
  const row = await one<{ count: string }>('SELECT count(*)::text AS count FROM pending_emails');
  return Number(row?.count ?? '0');
}
