import type { IncomingMessage } from 'node:http';
import { query, withTransaction, type Queryable } from '../db/pool.ts';
import { businessDate, monthLabel } from '../../shared/dates.ts';
import { isLegalEnquiryMove } from '../../shared/enquiryStatus.ts';
import { milestoneDescription, splitMilestones } from '../../shared/money.ts';
import { singleLineField } from '../domain/text.ts';
import { unwritableKeyErrors, WRITABLE_FIELDS, isJsonInteger } from '../domain/writable.ts';
import { ApiError, billingUnavailable, conflict, gone, notFound, validation } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import {
  bumpVersion,
  enquiryReadTimeStatus,
  lockEnquiry,
  readEnquiryRowByToken,
  type EnquiryRow,
} from '../repo/enquiries.ts';
import {
  beginIdempotentRequest,
  isValidIdempotencyKey,
  releaseIdempotentRequest,
  storeIdempotentResponse,
} from '../repo/idempotency.ts';
import { lockMonth, readMonth } from '../repo/months.ts';
import { readSettings } from '../repo/settings.ts';
import { renderDepositReceivedEmail, renderMonthHeldEmail } from '../services/emails.ts';
import { deliverQueued, queueEmail } from '../services/mail.ts';
import {
  createExternalCharge,
  findInvoicePaymentId,
  findOrCreateAccount,
  getInvoice,
  listAccountInvoices,
  listAccountPayments,
  recordPurchase,
  voidInvoice,
} from '../services/killbill.ts';

export type DepositView = {
  invoice_number: string;
  killbill_invoice_id: string;
  amount_cents: number;
  balance_cents: number;
  paid: boolean;
  invoice_date: string;
  billing: 'live' | 'unreachable';
};

function depositTransactionKey(reference: string): string {
  return `earshot-${reference}-deposit`;
}

function accountExternalKey(reference: string): string {
  return `earshot-${reference}`;
}

async function readDeposit(row: EnquiryRow): Promise<DepositView | null> {
  if (row.deposit_invoice_id === null) return null;
  const stored: DepositView = {
    invoice_number: row.deposit_invoice_number ?? '',
    killbill_invoice_id: row.deposit_invoice_id,
    amount_cents: Number(row.deposit_amount_cents ?? 0),
    balance_cents: Number(row.deposit_balance_cents ?? 0),
    paid: Number(row.deposit_balance_cents ?? 0) === 0,
    invoice_date: row.deposit_invoice_date ?? '',
    billing: 'unreachable',
  };
  try {
    const invoice = await getInvoice(row.deposit_invoice_id);
    const item = invoice.items.find((candidate) => candidate.description.startsWith('Milestone 1 of 4'));
    const live: DepositView = {
      invoice_number: invoice.invoice_number,
      killbill_invoice_id: invoice.invoice_id,
      amount_cents: invoice.amount_cents,
      balance_cents: invoice.balance_cents,
      paid: invoice.balance_cents === 0,
      invoice_date: item?.start_date ?? row.deposit_invoice_date ?? '',
      billing: 'live',
    };
    await query(
      `UPDATE proposals SET deposit_amount_cents = $2, deposit_balance_cents = $3, deposit_invoice_number = $4,
         deposit_invoice_date = $5 WHERE id = $1`,
      [row.proposal_id, live.amount_cents, live.balance_cents, live.invoice_number, live.invoice_date],
    );
    return live;
  } catch {
    return stored;
  }
}

async function proposalBody(row: EnquiryRow, now: Date): Promise<Record<string, unknown>> {
  const month = await readMonth(row.production_month as string);
  const deposit = await readDeposit(row);
  return {
    reference: row.reference,
    project_title: row.proposal_project_title,
    scope: row.scope,
    fee_cents: Number(row.fee_cents),
    currency: 'USD',
    production_month: row.production_month,
    production_month_label: monthLabel(row.production_month as string),
    month_open: month?.open ?? false,
    milestones: splitMilestones(Number(row.fee_cents)),
    status: enquiryReadTimeStatus(row, now),
    expires_at: (row.proposal_expires_at as Date).toISOString(),
    deposit,
  };
}

async function loadProposal(token: string, now: Date, client?: Queryable): Promise<EnquiryRow> {
  const row = await readEnquiryRowByToken(token, client);
  if (row === null) throw notFound('That proposal does not exist.');
  if (row.status === 'declined') throw gone('proposal_closed', 'That proposal is no longer open.');
  if (enquiryReadTimeStatus(row, now) === 'expired') {
    throw gone('proposal_expired', 'That proposal has expired.');
  }
  return row;
}

function idempotencyKeyOf(request: IncomingMessage): string {
  const header = request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!isValidIdempotencyKey(value)) {
    throw validation({ 'Idempotency-Key': 'Use 1 to 100 visible ASCII characters.' });
  }
  return value;
}

async function acceptProposal(token: string, now: Date): Promise<Record<string, unknown>> {
  const settings = await readSettings();
  let createdInvoiceId: string | null = null;

  const outcome = await withTransaction(async (client) => {
    const found = await readEnquiryRowByToken(token, client);
    if (found === null) throw notFound('That proposal does not exist.');
    const locked = await lockEnquiry(client, found.id);
    if (locked === null) throw notFound('That proposal does not exist.');
    if (locked.status === 'declined') throw gone('proposal_closed', 'That proposal is no longer open.');
    if (enquiryReadTimeStatus(locked, now) === 'expired') {
      throw gone('proposal_expired', 'That proposal has expired.');
    }
    if (!isLegalEnquiryMove(locked.status, 'accepted')) {
      throw conflict('illegal_transition', 'That proposal has already been accepted.', {
        from: locked.status,
        to: 'accepted',
      });
    }

    const month = await lockMonth(client, locked.production_month as string);
    if (!month.open) {
      throw conflict('month_taken', 'That production month has just been taken.', { month: month.month });
    }

    const accountId = await findOrCreateAccount({
      externalKey: accountExternalKey(locked.reference),
      name: locked.producer_name as string,
      email: locked.producer_email as string,
      company: locked.studio,
      timeZone: settings.time_zone,
    });

    for (const invoice of await listAccountInvoices(accountId)) {
      if (invoice.balance_cents !== 0) await voidInvoice(invoice.invoice_id);
    }

    const feeCents = Number(locked.fee_cents);
    const depositCents = (splitMilestones(feeCents)[0] as { amount_cents: number }).amount_cents;
    const chargeDate = businessDate(now, settings.time_zone);
    const invoice = await createExternalCharge({
      accountId,
      amountCents: depositCents,
      description: milestoneDescription(1, locked.reference),
      businessDate: chargeDate,
    });
    createdInvoiceId = invoice.invoice_id;
    const item = invoice.items.find((candidate) => candidate.description.startsWith('Milestone 1 of 4'));

    await client.query(
      `UPDATE proposals SET killbill_account_id = $2, deposit_invoice_id = $3, deposit_invoice_number = $4,
         deposit_amount_cents = $5, deposit_balance_cents = $6, deposit_invoice_date = $7
       WHERE id = $1`,
      [
        locked.proposal_id,
        accountId,
        invoice.invoice_id,
        invoice.invoice_number,
        invoice.amount_cents,
        invoice.balance_cents,
        item?.start_date ?? chargeDate,
      ],
    );
    await client.query(`UPDATE enquiries SET status = 'accepted' WHERE id = $1`, [locked.id]);
    await bumpVersion(client, locked.id);

    const heldId = await queueEmail(client, {
      kind: 'month_held',
      enquiryId: locked.id,
      reference: locked.reference,
      message: renderMonthHeldEmail({
        producerName: locked.producer_name as string,
        producerEmail: locked.producer_email as string,
        projectTitle: locked.proposal_project_title as string,
        feeCents,
        productionMonth: locked.production_month as string,
        token,
        expiresAt: locked.proposal_expires_at as Date,
        depositCents: invoice.amount_cents,
        invoiceNumber: invoice.invoice_number,
        timeZone: settings.time_zone,
        queuedAt: now,
      }),
    });

    return {
      heldId,
      deposit: {
        invoice_number: invoice.invoice_number,
        killbill_invoice_id: invoice.invoice_id,
        amount_cents: invoice.amount_cents,
        balance_cents: invoice.balance_cents,
        paid: invoice.balance_cents === 0,
        invoice_date: item?.start_date ?? chargeDate,
        billing: 'live' as const,
      },
    };
  }).catch(async (error: unknown) => {
    if (createdInvoiceId !== null) {
      await voidInvoice(createdInvoiceId).catch(() => undefined);
    }
    throw error;
  });

  const email = await deliverQueued(outcome.heldId);
  return { status: 'accepted', deposit: outcome.deposit, email: email === 'sent' ? 'sent' : 'pending' };
}

async function payDeposit(
  token: string,
  payerName: string,
  amountCents: number,
  now: Date,
): Promise<Record<string, unknown>> {
  const settings = await readSettings();
  const outcome = await withTransaction(async (client) => {
    const found = await readEnquiryRowByToken(token, client);
    if (found === null) throw notFound('That proposal does not exist.');
    const locked = await lockEnquiry(client, found.id);
    if (locked === null) throw notFound('That proposal does not exist.');
    if (locked.status !== 'accepted') {
      throw conflict('illegal_transition', 'That deposit cannot be paid from the proposal\u2019s current state.', {
        from: enquiryReadTimeStatus(locked, now),
        to: 'deposit_paid',
      });
    }

    const invoiceId = locked.deposit_invoice_id as string;
    const accountId = locked.killbill_account_id as string;
    const invoice = await getInvoice(invoiceId);
    if (amountCents !== invoice.amount_cents) {
      throw validation({ amount_cents: 'That is not the deposit amount.' });
    }

    const transactionKey = depositTransactionKey(locked.reference);
    const payments = await listAccountPayments(accountId);
    const adopted = payments.find((payment) => payment.transaction_keys.includes(transactionKey));
    let paymentId: string;
    if (adopted !== undefined) {
      paymentId = adopted.payment_id;
    } else if (invoice.balance_cents === 0) {
      const settled = await findInvoicePaymentId(invoiceId);
      if (settled === null) throw billingUnavailable();
      paymentId = settled;
    } else {
      paymentId = await recordPurchase({
        accountId,
        invoiceId,
        amountCents: invoice.balance_cents,
        transactionExternalKey: transactionKey,
      });
    }

    const settled = await getInvoice(invoiceId);
    const paidAt = now;
    await client.query(
      `UPDATE proposals SET deposit_payment_id = $2, deposit_paid_at = $3, deposit_balance_cents = $4,
         deposit_amount_cents = $5, deposit_payer_name = $6 WHERE id = $1`,
      [locked.proposal_id, paymentId, paidAt, settled.balance_cents, settled.amount_cents, payerName],
    );
    await client.query(`UPDATE enquiries SET status = 'deposit_paid' WHERE id = $1`, [locked.id]);
    await bumpVersion(client, locked.id);

    const depositEmailId = await queueEmail(client, {
      kind: 'deposit',
      enquiryId: locked.id,
      reference: locked.reference,
      message: renderDepositReceivedEmail({
        producerName: locked.producer_name as string,
        producerEmail: locked.producer_email as string,
        projectTitle: locked.proposal_project_title as string,
        productionMonth: locked.production_month as string,
        depositCents: settled.amount_cents,
        invoiceNumber: settled.invoice_number,
        paidAt,
        timeZone: settings.time_zone,
        queuedAt: now,
      }),
    });

    return {
      depositEmailId,
      body: {
        status: 'deposit_paid',
        payment_id: paymentId,
        invoice_number: settled.invoice_number,
        amount_cents: settled.amount_cents,
        paid_at: paidAt.toISOString(),
      },
    };
  });

  const email = await deliverQueued(outcome.depositEmailId);
  return { ...outcome.body, email: email === 'sent' ? 'sent' : 'pending' };
}

export const proposalRoutes: readonly Route[] = [
  {
    path: '/api/proposals/:token',
    method: 'GET',
    handler: async ({ response, params, now }) => {
      const row = await loadProposal(params.token as string, now);
      sendJson(response, 200, await proposalBody(row, now));
    },
  },
  {
    path: '/api/proposals/:token/accept',
    method: 'POST',
    handler: async ({ response, params, json, now }) => {
      const unwritable = unwritableKeyErrors(json, WRITABLE_FIELDS.empty);
      if (Object.keys(unwritable).length > 0) throw validation(unwritable);
      const body = await acceptProposal(params.token as string, now);
      sendJson(response, 201, body);
    },
  },
  {
    path: '/api/proposals/:token/deposit',
    method: 'POST',
    handler: async ({ request, response, params, json, now }) => {
      const token = params.token as string;
      const exists = await readEnquiryRowByToken(token, undefined);
      if (exists === null) throw notFound('That proposal does not exist.');

      const key = idempotencyKeyOf(request);
      const fingerprint = JSON.stringify({
        payer_name: json.payer_name ?? null,
        amount_cents: json.amount_cents ?? null,
      });
      const lookup = await beginIdempotentRequest('deposit', `${token}:${key}`, fingerprint);
      if (lookup.kind === 'stored') {
        sendJson(response, lookup.status, lookup.body);
        return;
      }
      if (lookup.kind === 'conflict') {
        throw conflict('idempotency_conflict', 'That idempotency key was used for a different payment.');
      }
      if (lookup.kind === 'in_progress') {
        throw conflict('request_in_progress', 'That payment is still being recorded.');
      }

      try {
        if (exists.status === 'declined') throw gone('proposal_closed', 'That proposal is no longer open.');
        if (enquiryReadTimeStatus(exists, now) === 'expired') {
          throw gone('proposal_expired', 'That proposal has expired.');
        }
        if (exists.status !== 'accepted') {
          throw conflict('illegal_transition', 'That deposit cannot be paid from the proposal\u2019s current state.', {
            from: enquiryReadTimeStatus(exists, now),
            to: 'deposit_paid',
          });
        }

        const unwritable = unwritableKeyErrors(json, WRITABLE_FIELDS.deposit);
        const payer = singleLineField(json.payer_name, 1, 120);
        if (!payer.ok) unwritable.payer_name = payer.message;
        if (!isJsonInteger(json.amount_cents)) unwritable.amount_cents = 'Must be a whole number of cents.';
        if (Object.keys(unwritable).length > 0) throw validation(unwritable);

        const body = await payDeposit(
          token,
          (payer as { value: string }).value,
          json.amount_cents as number,
          now,
        );
        await storeIdempotentResponse('deposit', `${token}:${key}`, 200, body);
        sendJson(response, 200, body);
      } catch (error) {
        if (error instanceof ApiError && error.status !== 503) {
          await storeIdempotentResponse('deposit', `${token}:${key}`, error.status, error.body());
        } else {
          await releaseIdempotentRequest('deposit', `${token}:${key}`);
        }
        throw error;
      }
    },
  },
];
