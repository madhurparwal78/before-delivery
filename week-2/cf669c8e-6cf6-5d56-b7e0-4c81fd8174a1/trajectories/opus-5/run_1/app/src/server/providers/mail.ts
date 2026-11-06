/**
 * Mail through Mailpit.
 *
 * Each mail is claimed in PostgreSQL inside the same transaction as the fact it
 * reports, so instances sharing a database send it exactly once and only after
 * the fact is true. Sending happens after the commit and retries in the
 * background; a mail failure never changes order or ride state.
 *
 * Every money figure in a mail carries its status word.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { PoolClient } from 'pg';

import { formatAmount } from '../../shared/format.js';
import { query } from '../db/pool.js';

const RETRY_INTERVAL_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const mailFrom = requireEnv('MAIL_FROM');
const smtpHost = requireEnv('SMTP_HOST');
const smtpPort = Number(requireEnv('SMTP_PORT'));

let transporter: Transporter | null = null;
function transport(): Transporter {
  transporter ??= createTransport({ host: smtpHost, port: smtpPort, secure: false, ignoreTLS: true });
  return transporter;
}

export type MailKind =
  | 'vat-receipt'
  | 'credit-note'
  | 'vat-correction'
  | 'inspection-record'
  | 'test-ride-confirmation';

export interface MailDraft {
  dedupeKey: string;
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Claim a mail as part of the fact it reports. Returns true when this
 * transaction won the claim and the mail should be sent after the commit.
 */
export async function claimMail(client: PoolClient, draft: MailDraft): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO mail_records(dedupe_key, kind, recipient, subject, body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING dedupe_key`,
    [draft.dedupeKey, draft.kind, draft.recipient, draft.subject, draft.body],
  );
  return inserted.rowCount === 1;
}

async function send(record: { dedupe_key: string; recipient: string; subject: string; body: string }): Promise<void> {
  await transport().sendMail({
    from: mailFrom,
    to: record.recipient,
    subject: record.subject,
    text: record.body,
  });
  await query('UPDATE mail_records SET sent = true WHERE dedupe_key = $1', [record.dedupe_key]);
}

/** Send every claimed mail that has not gone out yet. */
export async function flushMail(): Promise<void> {
  const pending = await query<{
    dedupe_key: string;
    recipient: string;
    subject: string;
    body: string;
  }>(
    `UPDATE mail_records SET attempts = attempts + 1
     WHERE dedupe_key IN (SELECT dedupe_key FROM mail_records WHERE sent = false ORDER BY created_at LIMIT 20)
     RETURNING dedupe_key, recipient, subject, body`,
  );
  for (const record of pending.rows) {
    try {
      await send(record);
    } catch (error) {
      console.error(`[mail] ${record.dedupe_key} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

export function startMailRetry(): void {
  setInterval(() => {
    void flushMail().catch(() => undefined);
  }, RETRY_INTERVAL_MS).unref();
}

/** `<amount>` followed by its status word, as every money figure must be. */
export function amountWithStatus(cents: number, status: string): string {
  return `${formatAmount(cents)} ${status}`;
}

export interface ReceiptLine {
  name: string;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

export function vatReceiptMail(input: {
  orderNumber: string;
  stageLabel: string;
  recipient: string;
  orderId: string;
  stage: string;
  amountCents: number;
  vatCents: number;
  netCents: number;
  lines: readonly ReceiptLine[];
}): MailDraft {
  const lines = input.lines
    .filter((line) => line.grossCents !== 0)
    .map(
      (line) =>
        `  ${line.name}: ${amountWithStatus(line.grossCents, 'paid')} (VAT ${amountWithStatus(line.vatCents, 'paid')}, net ${amountWithStatus(line.netCents, 'paid')})`,
    )
    .join('\n');

  return {
    dedupeKey: `vat-receipt:${input.orderId}:${input.stage}`,
    kind: 'vat-receipt',
    recipient: input.recipient,
    subject: `VAT receipt: ${input.stageLabel} for order ${input.orderNumber}`,
    body: [
      `VAT receipt for order ${input.orderNumber}.`,
      '',
      `${input.stageLabel} paid: ${amountWithStatus(input.amountCents, 'paid')}`,
      `VAT: ${amountWithStatus(input.vatCents, 'paid')}`,
      `Net: ${amountWithStatus(input.netCents, 'paid')}`,
      '',
      'Per line:',
      lines,
      '',
      'Ommezwaai Feeler',
    ].join('\n'),
  };
}

export function creditNoteMail(input: {
  orderNumber: string;
  recipient: string;
  refundId: string;
  lineName: string;
  returnedCents: number;
  vatReversedCents: number;
}): MailDraft {
  return {
    dedupeKey: `credit-note:${input.refundId}`,
    kind: 'credit-note',
    recipient: input.recipient,
    subject: `Credit note for order ${input.orderNumber}: ${formatAmount(input.returnedCents)}`,
    body: [
      `Credit note for order ${input.orderNumber}.`,
      '',
      `Line: ${input.lineName}`,
      `Returned: ${amountWithStatus(input.returnedCents, 'returned')}`,
      `VAT reversed: ${amountWithStatus(input.vatReversedCents, 'returned')}`,
      '',
      'Ommezwaai Feeler',
    ].join('\n'),
  };
}

export function vatCorrectionMail(input: {
  orderNumber: string;
  recipient: string;
  orderId: string;
  correctionCents: number;
  stages: readonly { label: string; oldVatCents: number; newVatCents: number }[];
}): MailDraft {
  const stages = input.stages
    .map(
      (stage) =>
        `  ${stage.label}: VAT was ${amountWithStatus(stage.oldVatCents, 'paid')}, now ${amountWithStatus(stage.newVatCents, 'corrected')}`,
    )
    .join('\n');

  return {
    dedupeKey: `vat-correction:${input.orderId}`,
    kind: 'vat-correction',
    recipient: input.recipient,
    subject: `VAT correction for order ${input.orderNumber}: ${formatAmount(input.correctionCents)}`,
    body: [
      `VAT correction for order ${input.orderNumber}, after switching to workshop fitting.`,
      '',
      'Per paid stage:',
      stages,
      '',
      `Correction: ${amountWithStatus(input.correctionCents, 'corrected')}`,
      '',
      'Ommezwaai Feeler',
    ].join('\n'),
  };
}

export function inspectionRecordMail(input: {
  orderNumber: string;
  recipient: string;
  orderId: string;
  plate: string;
  className: string;
  feeCents: number;
}): MailDraft {
  return {
    dedupeKey: `inspection-record:${input.orderId}`,
    kind: 'inspection-record',
    recipient: input.recipient,
    subject: `Inspection recorded for order ${input.orderNumber}`,
    body: [
      `Inspection recorded for order ${input.orderNumber}.`,
      '',
      `Plate: ${input.plate}`,
      `New class: ${input.className}`,
      `Inspection fee: ${amountWithStatus(input.feeCents, 'paid')}`,
      '',
      'Fit the new plate before riding.',
      '',
      'Ommezwaai Feeler',
    ].join('\n'),
  };
}

export function testRideConfirmationMail(input: {
  recipient: string;
  rideId: string;
  bikeName: string;
  localDate: string;
  localTime: string;
}): MailDraft {
  return {
    dedupeKey: `test-ride-confirmation:${input.rideId}`,
    kind: 'test-ride-confirmation',
    recipient: input.recipient,
    subject: `Test ride confirmed: ${input.bikeName} on ${input.localDate} at ${input.localTime}`,
    body: [
      'Test ride confirmed.',
      '',
      `Bike: ${input.bikeName}`,
      `Date: ${input.localDate}`,
      `Time: ${input.localTime}`,
      `Your ride: /rides/${input.rideId}`,
      '',
      'Ommezwaai Feeler',
    ].join('\n'),
  };
}
