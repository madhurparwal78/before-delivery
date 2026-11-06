import { Author, InvoiceDto, PaymentDto } from '../../shared/api';
import { formatMoney, formatLocalTime } from '../../shared/format';
import { PeriodId, PlanId, isUpgrade, planOffer } from '../../shared/plans';
import { pool, query, transaction } from '../db/pool';
import { ApiError, fail } from '../http/errors';
import * as kb from '../services/killbill';
import { enqueueMail } from '../services/mail';
import { deleteObject, putObject, storageKeys, storageReachable } from '../services/storage';
import { sha256Hex } from '../util/crypto';
import {
  SubscriptionRow,
  WorkspaceRow,
  billingContacts,
  getSubscription,
} from '../domain/workspace';
import { renderInvoicePdf } from './invoicePdf';

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

const DECLINED_CARD = '4000000000000002';

function luhnValid(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function parseCard(raw: unknown, path = 'card'): CardInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail.validation({ [path]: 'Card details are required' });
  }
  const card = raw as Record<string, unknown>;
  if (typeof card.number !== 'string' || !/^\d+$/.test(card.number)) {
    throw fail.validation({ [`${path}.number`]: 'Must be digits only' });
  }
  if (card.number.length < 13 || card.number.length > 19 || !luhnValid(card.number)) {
    throw fail.validation({ [`${path}.number`]: 'Card number is not valid' });
  }
  if (typeof card.expMonth !== 'number' || !Number.isInteger(card.expMonth)) {
    throw fail.validation({ [`${path}.expMonth`]: 'Must be a whole number' });
  }
  if (card.expMonth < 1 || card.expMonth > 12) {
    throw fail.validation({ [`${path}.expMonth`]: 'Must be between 1 and 12' });
  }
  if (
    typeof card.expYear !== 'number' ||
    !Number.isInteger(card.expYear) ||
    card.expYear < 1000 ||
    card.expYear > 9999
  ) {
    throw fail.validation({ [`${path}.expYear`]: 'Must be a four-digit year' });
  }
  if (typeof card.cvc !== 'string' || !/^\d{3,4}$/.test(card.cvc)) {
    throw fail.validation({ [`${path}.cvc`]: 'Must be 3 or 4 digits' });
  }
  const now = new Date();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const cardMonth = card.expYear * 12 + (card.expMonth - 1);
  if (cardMonth < currentMonth) {
    throw fail.validation({ [`${path}.expMonth`]: 'The card has expired' });
  }
  return {
    number: card.number,
    expMonth: card.expMonth,
    expYear: card.expYear,
    cvc: card.cvc,
  };
}

export function assertCardAccepted(card: CardInput): void {
  if (card.number === DECLINED_CARD) throw fail.cardDeclined();
}

export function cardLast4(card: CardInput): string {
  return card.number.slice(-4);
}

export interface IdempotentOutcome {
  status: number;
  body: unknown;
  replayed: boolean;
}

export function requireIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header.length < 1 || header.length > 200 || !/^[\x20-\x7e]+$/.test(header)) {
    throw fail.validation({ 'Idempotency-Key': 'Required' });
  }
  return header;
}

export async function withIdempotency(
  workspaceId: string,
  key: string,
  route: string,
  rawBody: Buffer,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentOutcome> {
  const bodyHash = sha256Hex(rawBody);
  const claimed = await query<{ claimed: boolean }>(
    `INSERT INTO idempotency_records (workspace_id, key, route, body_sha256)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, key) DO NOTHING
     RETURNING true AS claimed`,
    [workspaceId, key, route, bodyHash],
  );
  if (claimed.length === 0) {
    const rows = await query<{
      body_sha256: string;
      status: number | null;
      response: unknown;
      in_progress: boolean;
    }>(
      `SELECT body_sha256, status, response, in_progress FROM idempotency_records
       WHERE workspace_id = $1 AND key = $2`,
      [workspaceId, key],
    );
    const record = rows[0];
    if (!record) throw fail.conflict('request_in_progress');
    if (record.body_sha256 !== bodyHash) throw fail.conflict('idempotency_key_reused');
    if (record.in_progress) throw fail.conflict('request_in_progress');
    return { status: record.status ?? 200, body: record.response, replayed: true };
  }
  try {
    const result = await handler();
    await query(
      `UPDATE idempotency_records SET status = $3, response = $4::jsonb, in_progress = false
       WHERE workspace_id = $1 AND key = $2`,
      [workspaceId, key, result.status, JSON.stringify(result.body ?? null)],
    );
    return { status: result.status, body: result.body, replayed: false };
  } catch (error) {
    if (error instanceof ApiError && error.status !== 503) {
      await query(
        `UPDATE idempotency_records SET status = $3, response = $4::jsonb, in_progress = false
         WHERE workspace_id = $1 AND key = $2`,
        [workspaceId, key, error.status, JSON.stringify(error.body)],
      );
    } else {
      await query(`DELETE FROM idempotency_records WHERE workspace_id = $1 AND key = $2`, [
        workspaceId,
        key,
      ]);
    }
    throw error;
  }
}

export function invoiceDto(invoice: kb.KbInvoice, pdfStored: boolean): InvoiceDto {
  const balanceCents = kb.toCents(invoice.balance);
  return {
    id: invoice.invoiceId,
    number: invoice.invoiceNumber,
    date: invoice.invoiceDate,
    amountCents: kb.toCents(invoice.amount),
    balanceCents,
    status: balanceCents <= 0 ? 'paid' : 'unpaid',
    pdfAvailable: pdfStored,
  };
}

export function paymentDto(payment: kb.KbPayment, invoiceId: string, createdAt: string): PaymentDto {
  const refunded = payment.transactions
    .filter((transaction) => transaction.transactionType === 'REFUND' && transaction.status === 'SUCCESS')
    .reduce((total, transaction) => total + kb.toCents(transaction.amount), 0);
  return {
    id: payment.paymentId,
    invoiceId,
    amountCents: kb.toCents(payment.purchasedAmount),
    refundedCents: refunded,
    createdAt,
  };
}

export async function rememberInvoice(
  workspaceId: string,
  invoice: kb.KbInvoice,
  pdfStored: boolean,
): Promise<void> {
  await query(
    `INSERT INTO invoice_records (id, workspace_id, number, amount_cents, balance_cents, invoice_date, pdf_stored)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET number = EXCLUDED.number,
           amount_cents = EXCLUDED.amount_cents,
           balance_cents = EXCLUDED.balance_cents,
           invoice_date = EXCLUDED.invoice_date,
           pdf_stored = invoice_records.pdf_stored OR EXCLUDED.pdf_stored,
           seen_at = now()`,
    [
      invoice.invoiceId,
      workspaceId,
      invoice.invoiceNumber,
      kb.toCents(invoice.amount),
      kb.toCents(invoice.balance),
      invoice.invoiceDate,
      pdfStored,
    ],
  );
}

export async function pdfStoredIds(workspaceId: string): Promise<Set<string>> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM invoice_records WHERE workspace_id = $1 AND pdf_stored = true`,
    [workspaceId],
  );
  return new Set(rows.map((row) => row.id));
}

export interface RecordedPayment {
  invoice: kb.KbInvoice;
  payment: kb.KbPayment;
}

/**
 * Pays one invoice as one unit: the document is written first, then the Kill Bill
 * payment, then the stored record and the receipt. A failure at any step leaves
 * nothing behind.
 */
export async function payInvoiceAllOrNothing(options: {
  workspace: WorkspaceRow;
  accountId: string;
  invoiceId: string;
  transactionExternalKey: string;
  actor: Author;
}): Promise<RecordedPayment> {
  const invoice = await kb.getInvoice(options.invoiceId);
  const balanceCents = kb.toCents(invoice.balance);
  if (balanceCents <= 0) throw fail.conflict('invoice_already_paid');
  if (!(await storageReachable())) throw fail.serviceDown('file_storage');

  const pdfKey = storageKeys.invoice(options.workspace.id, invoice.invoiceId);
  await putObject(
    pdfKey,
    renderInvoicePdf({
      workspaceName: options.workspace.name,
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      lineItems: invoice.items.map((item) => ({
        description: `${item.description ?? item.itemType}${item.planName ? ` (${item.planName})` : ''}`,
        amountCents: kb.toCents(item.amount),
      })),
      totalCents: kb.toCents(invoice.amount),
      amountPaidCents: balanceCents,
    }),
    'application/pdf',
  );

  let payment: kb.KbPayment;
  try {
    payment = await kb.payInvoice({
      accountId: options.accountId,
      invoiceId: invoice.invoiceId,
      amountCents: balanceCents,
      transactionExternalKey: options.transactionExternalKey,
    });
  } catch (error) {
    await deleteObject(pdfKey).catch(() => undefined);
    throw error;
  }

  const contacts = await billingContacts(options.workspace.id);
  const fresh = await kb.getInvoice(invoice.invoiceId);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO invoice_records (id, workspace_id, number, amount_cents, balance_cents, invoice_date, pdf_stored)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (id) DO UPDATE
         SET balance_cents = EXCLUDED.balance_cents, pdf_stored = true, seen_at = now()`,
      [
        fresh.invoiceId,
        options.workspace.id,
        fresh.invoiceNumber,
        kb.toCents(fresh.amount),
        kb.toCents(fresh.balance),
        fresh.invoiceDate,
      ],
    );
    await client.query(
      `INSERT INTO payment_records (id, workspace_id, invoice_id, amount_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`,
      [payment.paymentId, options.workspace.id, fresh.invoiceId, balanceCents],
    );
    if (contacts.length > 0) {
      await enqueueMail(
        {
          dedupeKey: `receipt:${payment.paymentId}`,
          workspaceId: options.workspace.id,
          to: contacts.map((contact) => contact.email),
          subject: `Receipt for invoice ${fresh.invoiceNumber}: ${formatMoney(balanceCents)}`,
          body: [
            `Thank you — your payment for ${options.workspace.name} is recorded.`,
            '',
            `Invoice: ${fresh.invoiceNumber}`,
            `Amount paid: ${formatMoney(balanceCents)}`,
            `Date: ${fresh.invoiceDate}`,
          ].join('\n'),
        },
        client,
      );
    }
  });
  return { invoice: fresh, payment };
}

export interface SeatAddon {
  subscriptionId: string;
  planName: string;
  quantity: number;
}

export async function seatAddons(bundleId: string): Promise<SeatAddon[]> {
  const subscriptions = await kb.listBundleSubscriptions(bundleId);
  return subscriptions
    .filter(
      (subscription) =>
        subscription.productCategory === 'ADD_ON' &&
        subscription.state !== 'CANCELLED' &&
        subscription.cancelledDate === null &&
        subscription.planName.startsWith('seat-'),
    )
    .map((subscription) => ({
      subscriptionId: subscription.subscriptionId,
      planName: subscription.planName,
      quantity: subscription.quantity ?? 1,
    }));
}

export function extraSeatsOnAccount(addons: SeatAddon[]): number {
  return addons.reduce((total, addon) => total + addon.quantity, 0);
}

export function killbillProduct(plan: PlanId): string {
  return plan === 'team' ? 'Team' : 'Business';
}

export function killbillPeriod(period: PeriodId): 'MONTHLY' | 'ANNUAL' {
  return period === 'monthly' ? 'MONTHLY' : 'ANNUAL';
}

export function changePolicyFor(
  from: { plan: PlanId; period: PeriodId },
  to: { plan: PlanId; period: PeriodId },
): kb.BillingPolicy {
  return isUpgrade(from, to) ? 'IMMEDIATE' : 'END_OF_TERM';
}

export async function unpaidInvoices(accountId: string): Promise<kb.KbInvoice[]> {
  const invoices = await kb.listInvoices(accountId);
  return invoices.filter((invoice) => kb.toCents(invoice.balance) > 0);
}

export async function updateSubscriptionRow(
  workspaceId: string,
  patch: Partial<{
    state: SubscriptionRow['state'];
    plan: PlanId;
    period: PeriodId;
    extra_seats: number;
    trial_ends_at: Date | null;
    grace_ends_at: Date | null;
    failed_at: Date | null;
    suspended_reason: string | null;
    pending_change: SubscriptionRow['pending_change'];
    card_last4: string | null;
    kb_account_id: string | null;
    kb_bundle_id: string | null;
    kb_base_subscription_id: string | null;
  }>,
): Promise<SubscriptionRow> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return getSubscription(workspaceId);
  const assignments = entries
    .map(([column], index) => `${column} = $${index + 2}${column === 'pending_change' ? '::jsonb' : ''}`)
    .join(', ');
  const values = entries.map(([column, value]) =>
    column === 'pending_change' ? (value === null ? null : JSON.stringify(value)) : value,
  );
  await pool.query(
    `UPDATE subscriptions SET ${assignments}, updated_at = now() WHERE workspace_id = $1`,
    [workspaceId, ...values],
  );
  return getSubscription(workspaceId);
}

export async function sendRefundMail(options: {
  workspace: WorkspaceRow;
  invoiceNumber: string;
  amountCents: number;
  paymentId: string;
  transactionKey: string;
}): Promise<void> {
  const contacts = await billingContacts(options.workspace.id);
  if (contacts.length === 0) return;
  await enqueueMail({
    dedupeKey: `refund:${options.transactionKey}`,
    workspaceId: options.workspace.id,
    to: contacts.map((contact) => contact.email),
    subject: `Refund for invoice ${options.invoiceNumber}: ${formatMoney(options.amountCents)}`,
    body: [
      `A refund for ${options.workspace.name} is recorded.`,
      '',
      `Invoice: ${options.invoiceNumber}`,
      `Refunded: ${formatMoney(options.amountCents)}`,
    ].join('\n'),
  });
}

export async function sendDunningNotice(options: {
  workspace: WorkspaceRow;
  step: 0 | 3 | 7;
  invoiceNumber: string;
  graceEndsAt: Date;
}): Promise<void> {
  const contacts = await billingContacts(options.workspace.id);
  if (contacts.length === 0) return;
  const subjects: Record<0 | 3 | 7, string> = {
    0: `Payment failed for ${options.workspace.name}`,
    3: `Reminder: payment still due for ${options.workspace.name}`,
    7: `Publishing suspended for ${options.workspace.name}`,
  };
  const deadline = formatLocalTime(
    options.graceEndsAt.toISOString(),
    options.workspace.time_zone,
  );
  const bodies: Record<0 | 3 | 7, string> = {
    0: `A payment for ${options.workspace.name} failed. Pay invoice ${options.invoiceNumber} by ${deadline} to keep publishing.`,
    3: `Invoice ${options.invoiceNumber} for ${options.workspace.name} is still unpaid. The grace period ends ${deadline}.`,
    7: `Publishing for ${options.workspace.name} is suspended until invoice ${options.invoiceNumber} is paid.`,
  };
  await enqueueMail({
    dedupeKey: `dunning:${options.workspace.id}:${options.graceEndsAt.getTime()}:${options.step}`,
    workspaceId: options.workspace.id,
    to: contacts.map((contact) => contact.email),
    subject: subjects[options.step],
    body: bodies[options.step],
  });
}

export function seatPlanFor(plan: PlanId, period: PeriodId): string {
  return planOffer(plan, period).killbillSeatPlan;
}
