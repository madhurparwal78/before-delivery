import { randomUUID } from 'node:crypto';
import { query, withTransaction, type Queryable } from '../db/pool.js';
import { publish } from '../jobs/events.js';
import * as killbill from '../services/killbill.js';
import { formatAmount } from '../../shared/money.js';
import { SPONSOR_SHARE_LABEL, type Venue } from '../../shared/seed.js';
import * as copy from '../../shared/copy.js';
import { formatDue, localDate } from '../../shared/venue-time.js';
import {
  createDocument,
  documentKeys,
  invoiceHtml,
} from './documents.js';
import { queueCrmEvent, queueEmail } from './notifications.js';
import {
  dueInstantFrom,
  venueOf,
  type CommissionRow,
  type FunderRow,
  type MilestoneRow,
} from './commissions.js';

/** Invoicing and payment confirmation. Paid state comes only from Kill Bill. */

export interface PayerAccount {
  userId: string;
  accountId: string;
  name: string;
  email: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  killbill_account_id: string | null;
}

/** The payer's one USD Kill Bill account, created on first need. */
export async function payerAccount(userId: string): Promise<PayerAccount> {
  const result = await query<UserRow>(
    'SELECT id, name, email, killbill_account_id FROM app_users WHERE id = $1',
    [userId],
  );
  const user = result.rows[0];
  if (!user) throw new Error(`no app user ${userId}`);
  if (user.killbill_account_id) {
    return { userId, accountId: user.killbill_account_id, name: user.name, email: user.email };
  }
  const accountId = await killbill.ensurePayerAccount(userId, user.name, user.email);
  await query('UPDATE app_users SET killbill_account_id = $2 WHERE id = $1', [userId, accountId]);
  return { userId, accountId, name: user.name, email: user.email };
}

function chargeDescriptions(
  commissionTitle: string,
  label: string,
): { work: string; tax: string } {
  return {
    work: `${commissionTitle} — ${label} — work`,
    tax: `${commissionTitle} — ${label} — sales tax`,
  };
}

/**
 * Invoice a milestone on its triggering event: one Kill Bill invoice with the
 * work and sales-tax items, a due date 14 days on at 23:59:59 venue time, its
 * invoice PDF and the milestone-due email.
 */
export async function invoiceMilestone(
  commission: CommissionRow,
  milestone: MilestoneRow,
  triggerAt: Date,
): Promise<MilestoneRow> {
  if (milestone.killbill_invoice_id !== null) return milestone;
  const venue = venueOf(commission);
  const payer = await payerAccount(commission.client_id);
  const descriptions = chargeDescriptions(commission.title, milestone.label);

  const invoice = await killbill.createChargeInvoice(payer.accountId, [
    { description: descriptions.work, amountCents: milestone.subtotal_cents },
    { description: descriptions.tax, amountCents: milestone.tax_cents },
  ]);

  const dueAt = dueInstantFrom(triggerAt, venue);
  const dueDate = localDate(dueAt, venue.timeZone);

  return withTransaction(async (tx) => {
    const documentId = await createDocument(tx, {
      commissionId: commission.id,
      kind: 'invoice',
      version: 1,
      label: `Invoice — ${milestone.label}`,
      objectKey: documentKeys.invoice(commission.id, invoice.killbillInvoiceId),
      payerMilestoneId: milestone.id,
      html: invoiceHtml({
        commissionTitle: commission.title,
        label: milestone.label,
        payerName: payer.name,
        invoiceNumber: invoice.invoiceNumber,
        subtotalCents: milestone.subtotal_cents,
        taxCents: milestone.tax_cents,
        totalCents: milestone.amount_cents,
        dueDate,
        timeZone: venue.timeZone,
      }),
    });

    const updated = await tx.query<MilestoneRow>(
      `UPDATE milestones
          SET state = 'invoiced',
              invoiced_at = $2,
              due_at = $3,
              killbill_invoice_id = $4,
              killbill_invoice_number = $5,
              document_id = $6
        WHERE id = $1
        RETURNING *`,
      [
        milestone.id,
        triggerAt,
        dueAt,
        invoice.killbillInvoiceId,
        invoice.invoiceNumber,
        documentId,
      ],
    );

    await queueEmail(tx, commission.id, `milestone-due:${milestone.id}`, {
      to: payer.email,
      subject: copy.milestoneDueSubject(milestone.label, commission.title),
      body: copy.milestoneDueBody(
        formatAmount(milestone.amount_cents),
        formatDue(dueDate, venue.timeZone),
      ),
    });

    const row = updated.rows[0];
    if (!row) throw new Error('milestone invoice update produced no row');
    return row;
  });
}

/** Invoice a sponsor's share when they accept their invite. */
export async function invoiceFunderShare(
  commission: CommissionRow,
  funder: FunderRow,
  sponsorUserId: string,
  acceptedAt: Date,
): Promise<FunderRow> {
  if (funder.killbill_invoice_id !== null) return funder;
  const venue = venueOf(commission);
  const payer = await payerAccount(sponsorUserId);
  const descriptions = chargeDescriptions(commission.title, SPONSOR_SHARE_LABEL);

  const invoice = await killbill.createChargeInvoice(payer.accountId, [
    { description: descriptions.work, amountCents: funder.subtotal_cents },
    { description: descriptions.tax, amountCents: funder.tax_cents },
  ]);

  const dueAt = dueInstantFrom(acceptedAt, venue);
  const dueDate = localDate(dueAt, venue.timeZone);

  return withTransaction(async (tx) => {
    const documentId = await createDocument(tx, {
      commissionId: commission.id,
      kind: 'invoice',
      version: 1,
      label: `Invoice — ${SPONSOR_SHARE_LABEL}`,
      objectKey: documentKeys.invoice(commission.id, invoice.killbillInvoiceId),
      payerFunderId: funder.id,
      html: invoiceHtml({
        commissionTitle: commission.title,
        label: SPONSOR_SHARE_LABEL,
        payerName: funder.name,
        invoiceNumber: invoice.invoiceNumber,
        subtotalCents: funder.subtotal_cents,
        taxCents: funder.tax_cents,
        totalCents: funder.amount_cents,
        dueDate,
        timeZone: venue.timeZone,
      }),
    });

    const updated = await tx.query<FunderRow>(
      `UPDATE funders
          SET state = 'accepted',
              accepted_user_id = $2,
              accepted_at = $3,
              due_at = $4,
              killbill_invoice_id = $5,
              killbill_invoice_number = $6,
              document_id = $7
        WHERE id = $1
        RETURNING *`,
      [
        funder.id,
        sponsorUserId,
        acceptedAt,
        dueAt,
        invoice.killbillInvoiceId,
        invoice.invoiceNumber,
        documentId,
      ],
    );

    await queueEmail(tx, commission.id, `share-due:${funder.id}`, {
      to: payer.email,
      subject: copy.milestoneDueSubject(SPONSOR_SHARE_LABEL, commission.title),
      body: copy.milestoneDueBody(
        formatAmount(funder.amount_cents),
        formatDue(dueDate, venue.timeZone),
      ),
    });

    const row = updated.rows[0];
    if (!row) throw new Error('funder invoice update produced no row');
    return row;
  });
}

export interface ConfirmedPayment {
  killbillPaymentId: string;
  killbillInvoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  subtotalCents: number;
  taxCents: number;
  paidAt: Date;
}

/**
 * Record a confirmed payment. One database transaction marks the milestone or
 * share paid and creates its ledger entry, receipt, notices, CRM event and
 * board event together.
 */
export async function recordMilestonePayment(options: {
  commission: CommissionRow;
  milestone: MilestoneRow;
  payer: PayerAccount;
  producerEmail: string | null;
  payment: ConfirmedPayment;
  venue: Venue;
}): Promise<void> {
  const { commission, milestone, payer, payment, venue } = options;
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE milestones
          SET state = 'paid', paid_at = $2, killbill_payment_id = $3
        WHERE id = $1`,
      [milestone.id, payment.paidAt, payment.killbillPaymentId],
    );
    await addLedgerEntry(tx, {
      commissionId: commission.id,
      payerName: payer.name,
      label: milestone.label,
      amountCents: payment.amountCents,
      killbillPaymentId: payment.killbillPaymentId,
      at: payment.paidAt,
    });
    await queueEmail(tx, commission.id, `receipt:${payment.killbillPaymentId}`, {
      to: payer.email,
      subject: copy.receiptSubject(commission.title, milestone.label),
      body: copy.receiptBody(
        formatAmount(payment.amountCents),
        formatAmount(payment.subtotalCents),
        formatAmount(payment.taxCents),
        payment.invoiceNumber,
        payment.killbillPaymentId,
      ),
    });
    await queueEmail(tx, commission.id, `milestone-paid-client:${milestone.id}`, {
      to: payer.email,
      subject: copy.milestonePaidSubject(milestone.label, commission.title),
      body: copy.milestonePaidBody(
        commission.title,
        milestone.label,
        formatAmount(payment.amountCents),
      ),
    });
    if (options.producerEmail) {
      await queueEmail(tx, commission.id, `milestone-paid-producer:${milestone.id}`, {
        to: options.producerEmail,
        subject: copy.milestonePaidSubject(milestone.label, commission.title),
        body: copy.milestonePaidBody(
          commission.title,
          milestone.label,
          formatAmount(payment.amountCents),
        ),
      });
    }
    await queueCrmEvent(tx, {
      commissionId: commission.id,
      clientId: commission.client_id,
      type: 'milestone.paid',
      occurredAt: payment.paidAt,
      data: {
        milestoneId: milestone.id,
        label: milestone.label,
        subtotalCents: payment.subtotalCents,
        taxCents: payment.taxCents,
        amountCents: payment.amountCents,
        killbillInvoiceId: payment.killbillInvoiceId,
        killbillPaymentId: payment.killbillPaymentId,
      },
    });
    await publish(tx, {
      type: 'payment.confirmed',
      commissionId: commission.id,
      payerName: payer.name,
      amountCents: payment.amountCents,
      label: milestone.label,
      audience: [commission.client_id, 'producer'],
    });
  });
  void venue;
}

/** Record a confirmed sponsor-share payment. */
export async function recordSharePayment(options: {
  commission: CommissionRow;
  funder: FunderRow;
  payer: PayerAccount;
  payment: ConfirmedPayment;
}): Promise<void> {
  const { commission, funder, payer, payment } = options;
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE funders
          SET state = 'paid', paid_at = $2, killbill_payment_id = $3
        WHERE id = $1`,
      [funder.id, payment.paidAt, payment.killbillPaymentId],
    );
    await addLedgerEntry(tx, {
      commissionId: commission.id,
      payerName: funder.name,
      label: SPONSOR_SHARE_LABEL,
      amountCents: payment.amountCents,
      killbillPaymentId: payment.killbillPaymentId,
      at: payment.paidAt,
    });
    await queueEmail(tx, commission.id, `receipt:${payment.killbillPaymentId}`, {
      to: payer.email,
      subject: copy.receiptSubject(commission.title, SPONSOR_SHARE_LABEL),
      body: copy.receiptBody(
        formatAmount(payment.amountCents),
        formatAmount(payment.subtotalCents),
        formatAmount(payment.taxCents),
        payment.invoiceNumber,
        payment.killbillPaymentId,
      ),
    });
    await publish(tx, {
      type: 'payment.confirmed',
      commissionId: commission.id,
      payerName: funder.name,
      amountCents: payment.amountCents,
      label: SPONSOR_SHARE_LABEL,
      audience: [commission.client_id, 'producer'],
    });
  });
}

export async function addLedgerEntry(
  tx: Queryable,
  entry: {
    commissionId: string;
    payerName: string;
    label: string;
    amountCents: number;
    killbillPaymentId: string;
    at: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger_entries (id, commission_id, payer_name, label, amount_cents, killbill_payment_id, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (killbill_payment_id) DO NOTHING`,
    [
      randomUUID(),
      entry.commissionId,
      entry.payerName,
      entry.label,
      entry.amountCents,
      entry.killbillPaymentId,
      entry.at,
    ],
  );
}

export async function producerEmail(): Promise<string | null> {
  const result = await query<{ email: string }>(
    `SELECT email FROM app_users WHERE 'producer' = ANY(roles) ORDER BY created_at LIMIT 1`,
  );
  return result.rows[0]?.email ?? null;
}
