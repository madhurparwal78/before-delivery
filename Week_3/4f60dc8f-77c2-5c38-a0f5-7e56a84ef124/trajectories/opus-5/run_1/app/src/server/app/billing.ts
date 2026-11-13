import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AppError, fail, validation } from '../http/app-error.js';
import { FIELD_COPY } from '../../shared/errors.js';
import {
  MILESTONE_LABEL,
  type EngagementView,
  type InvoiceView,
  type LedgerEntryView,
  type ReviewMilestone,
  type Service,
} from '../../shared/domain.js';
import {
  CHANGE_ORDER_NET_PENCE,
  convertPence,
  exponentOf,
  formatMoney,
  vatOn,
  type CurrencyCode,
} from '../../shared/money.js';
import { contactOfRole, setKillbillAccount, setOverdueBlocked, type BrandRow } from '../db/brands.js';
import {
  brandHasOverdueInvoice,
  claimCancel,
  currentModel,
  findEngagement,
  findInvoiceByMilestone,
  insertInvoice,
  insertLedgerEntry,
  failedInvoicesWithDeadline,
  listInvoiceLines,
  listInvoices,
  listLedger,
  listQuoteLines,
  lockEngagement,
  lockInvoice,
  lockQuoteAndTitles,
  markInvoiceIssued,
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceVoid,
  recordPaymentFailure,
  releaseCancel,
  revokeReviewLinks,
  setEngagementPhase,
  type EngagementRow,
  type InvoiceRow,
} from '../db/engagements.js';
import { enqueue } from '../db/outbox.js';
import { transaction, type Queryable } from '../db/pool.js';
import { listRates } from '../db/fx.js';
import { rateInEffect } from '../domain/fx.js';
import { buildQuote, resolvedLine } from '../domain/quote.js';
import { checkCard } from '../domain/cards.js';
import { allocateRefund, refundTransactionKey, type RefundablePayment } from '../domain/refunds.js';
import { dueForOverdue, isPayable, isVoidable, overdueAtFor } from '../domain/invoices.js';
import { cancelTransition, depositTransition } from '../domain/states.js';
import {
  BillingUnavailable,
  adjustInvoiceItemToZero,
  createAccount,
  createExternalChargeInvoice,
  findAccountByExternalKey,
  getInvoice,
  getInvoiceWithItemIds,
  getPayment,
  listAccountInvoices,
  payInvoice as killbillPayInvoice,
  refundPayment,
  setBlockingState,
  voidInvoice,
  type KbInvoice,
  type KbPayment,
} from '../services/killbill.js';
import { DocumentsUnavailable, renderPdf } from '../services/documents.js';
import { sendEmail } from '../services/mail.js';
import { servicesForRead } from './content.js';
import { documentHtml, documentText, moneyDocumentFor } from './documents.js';
import {
  engagementView,
  invoiceView,
  ledgerView,
  loadEngagementBundle,
} from '../serialise.js';

export const ensureKillbillAccount = async (brand: BrandRow): Promise<string> => {
  if (brand.killbill_account_id !== null) return brand.killbill_account_id;
  const existing = await findAccountByExternalKey(brand.id);
  if (existing !== null) {
    await setKillbillAccount(brand.id, existing.accountId);
    return existing.accountId;
  }
  const finance = await contactOfRole(brand.id, 'finance');
  const account = await createAccount({
    externalKey: brand.id,
    name: brand.name,
    email: finance?.email ?? '',
    currency: brand.currency,
  });
  await setKillbillAccount(brand.id, account.accountId);
  return account.accountId;
};

const brandOf = (engagement: EngagementRow): BrandRow => ({
  id: engagement.brand_id,
  name: engagement.brand_name,
  currency: engagement.brand_currency,
  killbill_account_id: engagement.killbill_account_id,
  overdue_blocked: false,
});

/** Kill Bill reports amounts in major units; this brings them back to minor units. */
const minorFromMajor = (amount: number, currency: CurrencyCode): bigint =>
  BigInt(Math.round(amount * 10 ** exponentOf(currency)));

/** Net GBP 180.00 at the locked rate, plus VAT on that converted net. */
export const changeOrderAmount = (
  rateE4: bigint,
  currency: CurrencyCode,
): { netMinor: bigint; vatMinor: bigint; totalMinor: bigint } => {
  const netMinor = convertPence(CHANGE_ORDER_NET_PENCE, rateE4, currency);
  const vat = vatOn(netMinor);
  return { netMinor, vatMinor: vat, totalMinor: netMinor + vat };
};

export const changeOrderDescription = (
  milestone: ReviewMilestone,
  round: number,
  reference: string,
): string => `Change order, ${MILESTONE_LABEL[milestone]} round ${round}, ${reference}`;

export type DepositResult = {
  engagement: EngagementView;
  invoice: InvoiceView;
  ledger_entry: LedgerEntryView;
};

const undoDeposit = async (
  engagementId: string,
  accountId: string,
  kbInvoice: KbInvoice | null,
  payment: KbPayment | null,
  purchasedMinor: bigint,
  currency: CurrencyCode,
): Promise<void> => {
  try {
    if (payment !== null && purchasedMinor > 0n)
      await refundPayment({
        paymentId: payment.paymentId,
        amountMinor: purchasedMinor,
        currency,
        transactionExternalKey: `${engagementId}:undo:${payment.paymentId}`,
      });
    if (kbInvoice !== null) {
      const detailed = await getInvoiceWithItemIds(kbInvoice.invoiceId);
      for (const item of detailed.items ?? [])
        await adjustInvoiceItemToZero(detailed.invoiceId, accountId, item.invoiceItemId);
    }
  } catch {
    /* the undo is best effort; the client is told about the original failure */
  }
};

export const payDeposit = async (
  engagementId: string,
  brand: BrandRow,
  card: unknown,
): Promise<DepositResult> => {
  const engagement = await findEngagement(engagementId);
  if (engagement === null) fail('not_found');
  const current = engagement as EngagementRow;

  const transition = depositTransition({
    state: current.state,
    finalsOut: current.finals_out,
    revisionMilestone: current.revision_milestone,
  });
  if ('error' in transition) fail(transition.error);

  if ((await listQuoteLines(current.id)).length === 0) fail('quote_empty');
  const model = await currentModel(current.id);
  if (model === null || model.measurement === 'failed') fail('model_missing');
  if (model.measurement !== 'measured') fail('measurement_pending');
  if (model.unit === null) fail('unit_unconfirmed');

  checkCard(card);

  const services = await servicesForRead();
  const rates = await listRates();

  let accountId = '';
  let kbInvoice: KbInvoice | null = null;
  let payment: KbPayment | null = null;
  let purchasedMinor = 0n;
  let written: { invoiceId: string; ledgerId: string } | null = null;

  try {
    written = await transaction(async (client) => {
      const locked = await lockEngagement(client, current.id);
      if (locked === null) fail('not_found');
      const row = locked as EngagementRow;
      if (row.state !== 'quoted') fail('invalid_state');
      accountId = await ensureKillbillAccount(brand);

      const lockedAt = new Date();
      const rateE4 = rateInEffect(rates, row.brand_currency, lockedAt);
      const quoteLines = await listQuoteLines(row.id, client);
      const quote = buildQuote({
        currency: row.brand_currency,
        revision: row.quote_revision,
        rateE4,
        fxLockedAt: lockedAt,
        lines: quoteLines.map((line) => ({
          shotCode: line.shot_code,
          quantity: line.quantity,
          lockedTitle: line.locked_title,
          lockedPricePence: line.locked_price_pence,
        })),
        services,
      });
      const depositMinor = BigInt(quote.milestones.deposit_minor);
      const description = `Deposit ${row.reference}`;

      kbInvoice = await createExternalChargeInvoice(accountId, row.brand_currency, [
        { description, amountMinor: depositMinor },
      ]);
      payment = await killbillPayInvoice({
        accountId,
        invoiceId: kbInvoice.invoiceId,
        amountMinor: depositMinor,
        currency: row.brand_currency,
      });
      purchasedMinor = depositMinor;
      if ((await getInvoice(kbInvoice.invoiceId)).balance !== 0) throw new BillingUnavailable();

      await lockQuoteAndTitles(
        client,
        row.id,
        rateE4,
        lockedAt,
        quoteLines.map((line) => ({
          shotCode: line.shot_code,
          ...resolvedLine(
            {
              shotCode: line.shot_code,
              quantity: line.quantity,
              lockedTitle: line.locked_title,
              lockedPricePence: line.locked_price_pence,
            },
            services,
          ),
        })),
      );

      const invoiceId = randomUUID();
      await insertInvoice(client, {
        id: invoiceId,
        engagementId: row.id,
        milestone: 'deposit',
        status: 'paid',
        amountMinor: depositMinor,
        currency: row.brand_currency,
        number: kbInvoice.invoiceNumber,
        killbillInvoiceId: kbInvoice.invoiceId,
        issuedAt: lockedAt,
        lines: [{ description, amountMinor: depositMinor }],
      });

      const ledgerId = randomUUID();
      await insertLedgerEntry(client, {
        id: ledgerId,
        engagementId: row.id,
        kind: 'deposit',
        amountMinor: depositMinor,
        currency: row.brand_currency,
        invoiceId,
        killbillPaymentId: payment.paymentId,
        transactionKey: `${row.id}:deposit`,
      });

      await setEngagementPhase(client, row.id, {
        state: 'deposit_paid',
        finalsOut: false,
        revisionMilestone: null,
      });

      const finance = await contactOfRole(row.brand_id, 'finance');
      const receipt = moneyDocumentFor({
        heading: 'Deposit receipt',
        amountLabel: 'Deposit paid',
        amountMinor: depositMinor,
        reference: row.reference,
        brandName: row.brand_name,
        quote: { ...quote, fx_locked: true, fx_locked_at: lockedAt.toISOString() },
        documentLines: [{ description, amountMinor: depositMinor }],
      });

      let pdf: Buffer | null = null;
      try {
        pdf = await renderPdf(documentHtml(receipt));
      } catch (error) {
        if (!(error instanceof DocumentsUnavailable)) throw error;
      }

      if (pdf === null) {
        await enqueue(
          client,
          'deposit_receipt_email',
          { engagement_id: row.id, invoice_id: invoiceId },
          `deposit_receipt:${row.id}`,
        );
      } else {
        await sendEmail({
          to: finance?.email ?? '',
          subject: `Deposit receipt: ${row.reference}`,
          text: documentText(receipt),
          attachments: [
            { filename: `${row.reference}-deposit.pdf`, contentType: 'application/pdf', bytes: pdf },
          ],
        });
      }

      await enqueue(
        client,
        'push',
        {
          title: 'Deposit paid',
          message: `${row.reference} \u00b7 ${row.brand_name} \u00b7 ${formatMoney(depositMinor, row.brand_currency)}`,
        },
        `push:deposit:${row.id}`,
      );

      return { invoiceId, ledgerId };
    });
  } catch (error) {
    await undoDeposit(current.id, accountId, kbInvoice, payment, purchasedMinor, current.brand_currency);
    throw error;
  }

  const refreshed = await findEngagement(current.id);
  const bundle = await loadEngagementBundle(refreshed as EngagementRow, services, rates);
  const invoiceEntry = bundle.invoices.find((entry) => entry.row.id === written.invoiceId);
  const ledgerEntry = bundle.ledger.find((entry) => entry.id === written.ledgerId);
  if (invoiceEntry === undefined || ledgerEntry === undefined) throw new BillingUnavailable();
  return {
    engagement: engagementView(bundle, 'client'),
    invoice: invoiceView(invoiceEntry.row, invoiceEntry.lines),
    ledger_entry: ledgerView(ledgerEntry),
  };
};

/** Accepting a milestone drafts its invoice: one share line plus its change-order lines. */
export const draftMilestoneInvoice = async (
  client: Queryable,
  engagement: EngagementRow,
  milestone: ReviewMilestone,
  services: readonly Service[],
  rounds: number,
): Promise<void> => {
  if ((await findInvoiceByMilestone(engagement.id, milestone)) !== null) return;
  const quoteLines = await listQuoteLines(engagement.id, client);
  const rateE4 = BigInt(engagement.fx_rate_e4 ?? '10000');
  const quote = buildQuote({
    currency: engagement.brand_currency,
    revision: engagement.quote_revision,
    rateE4,
    fxLockedAt: engagement.fx_locked_at,
    lines: quoteLines.map((line) => ({
      shotCode: line.shot_code,
      quantity: line.quantity,
      lockedTitle: line.locked_title,
      lockedPricePence: line.locked_price_pence,
    })),
    services,
  });
  const shareMinor = BigInt(
    milestone === 'look_dev' ? quote.milestones.look_dev_minor : quote.milestones.final_delivery_minor,
  );
  const lines = [
    { description: `${MILESTONE_LABEL[milestone]} ${engagement.reference}`, amountMinor: shareMinor },
  ];
  const changeOrder = changeOrderAmount(rateE4, engagement.brand_currency);
  for (let round = 3; round <= rounds; round += 1)
    lines.push({
      description: changeOrderDescription(milestone, round, engagement.reference),
      amountMinor: changeOrder.totalMinor,
    });

  await insertInvoice(client, {
    id: randomUUID(),
    engagementId: engagement.id,
    milestone,
    status: 'draft',
    amountMinor: lines.reduce((total, line) => total + line.amountMinor, 0n),
    currency: engagement.brand_currency,
    lines,
  });
};

export const issueInvoice = async (invoiceId: string): Promise<InvoiceView> =>
  transaction(async (client) => {
    const invoice = await lockInvoice(client, invoiceId);
    if (invoice === null) fail('not_found');
    const row = invoice as InvoiceRow;
    if (row.status !== 'draft') fail('invalid_state');

    const engagement = await findEngagement(row.engagement_id);
    const accountId = await ensureKillbillAccount(brandOf(engagement as EngagementRow));
    const lines = await listInvoiceLines(row.id);
    const shareDescription = lines[0]?.description ?? '';

    let kbInvoice: KbInvoice | null = null;
    for (const candidate of await listAccountInvoices(accountId)) {
      const detailed = await getInvoice(candidate.invoiceId);
      if ((detailed.items ?? []).some((item) => item.description === shareDescription)) {
        kbInvoice = detailed;
        break;
      }
    }
    if (kbInvoice === null)
      kbInvoice = await createExternalChargeInvoice(
        accountId,
        row.currency,
        lines.map((line) => ({
          description: line.description,
          amountMinor: BigInt(line.amount_minor),
        })),
      );

    const issued = await markInvoiceIssued(
      client,
      row.id,
      kbInvoice.invoiceNumber,
      kbInvoice.invoiceId,
    );
    await enqueue(client, 'invoice_issued_email', { invoice_id: row.id }, `invoice_issued:${row.id}`);
    return invoiceView(issued, lines);
  });

export type InvoicePaymentResult = { invoice: InvoiceView; ledger_entry: LedgerEntryView };

export const payMilestoneInvoice = async (
  invoiceId: string,
  brand: BrandRow,
  card: unknown,
): Promise<InvoicePaymentResult> => {
  const declined = await transaction(async (client) => {
    const invoice = await lockInvoice(client, invoiceId);
    if (invoice === null) fail('not_found');
    const row = invoice as InvoiceRow;
    if (!isPayable(row.status)) fail('invoice_not_payable');
    try {
      checkCard(card);
      return null;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'card_declined') throw error;
      const failed = await recordPaymentFailure(client, row.id, (firstFailedAt) =>
        overdueAtFor(firstFailedAt, config.overdueAfterSeconds),
      );
      await enqueue(
        client,
        'payment_failed_email',
        { invoice_id: row.id, attempt: failed.failed_attempts },
        `payment_failed:${row.id}:${failed.failed_attempts}`,
      );
      return error;
    }
  });
  if (declined !== null) throw declined;

  const accountId = await ensureKillbillAccount(brand);

  const written = await transaction(async (client) => {
    const invoice = await lockInvoice(client, invoiceId);
    if (invoice === null) fail('not_found');
    const row = invoice as InvoiceRow;
    if (!isPayable(row.status) || row.killbill_invoice_id === null) fail('invoice_not_payable');

    const payment = await killbillPayInvoice({
      accountId,
      invoiceId: row.killbill_invoice_id as string,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency,
    });
    const settled = await getInvoice(row.killbill_invoice_id as string);
    if (settled.balance !== 0 || payment.paymentId === undefined) throw new BillingUnavailable();

    await markInvoicePaid(client, row.id);
    const ledgerId = randomUUID();
    await insertLedgerEntry(client, {
      id: ledgerId,
      engagementId: row.engagement_id,
      kind: 'invoice_payment',
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency,
      invoiceId: row.id,
      killbillPaymentId: payment.paymentId,
      transactionKey: `${row.id}:payment`,
    });
    await enqueue(client, 'invoice_receipt_email', { invoice_id: row.id }, `invoice_receipt:${row.id}`);

    if (!(await brandHasOverdueInvoice(brand.id, [row.id]))) {
      await setBlockingState(accountId, 'CLEAR');
      await setOverdueBlocked(brand.id, false);
    }
    return { invoiceId: row.id, ledgerId, engagementId: row.engagement_id };
  });

  const invoice = (await lockInvoiceFresh(written.invoiceId)) as InvoiceRow;
  const lines = await listInvoiceLines(written.invoiceId);
  const entry = (await listLedger(written.engagementId)).find(
    (candidate) => candidate.id === written.ledgerId,
  );
  if (entry === undefined) throw new BillingUnavailable();
  return { invoice: invoiceView(invoice, lines), ledger_entry: ledgerView(entry) };
};

const lockInvoiceFresh = async (invoiceId: string): Promise<InvoiceRow | null> =>
  transaction(async (client) => lockInvoice(client, invoiceId));

/**
 * The overdue rule: a payment_failed invoice past its `overdue_at` turns overdue only once
 * Kill Bill confirms the brand's blocking state.
 */
export const settleOverdue = async (engagementId: string | null): Promise<void> => {
  const now = new Date();
  const candidates = (await failedInvoicesWithDeadline()).filter(
    (invoice) =>
      (engagementId === null || invoice.engagement_id === engagementId) &&
      dueForOverdue(invoice.status, invoice.overdue_at, now),
  );
  for (const invoice of candidates) {
    const engagement = await findEngagement(invoice.engagement_id);
    if (engagement === null) continue;
    try {
      const accountId = await ensureKillbillAccount(brandOf(engagement));
      await setBlockingState(accountId, 'OVERDUE');
      await setOverdueBlocked(engagement.brand_id, true);
      await transaction(async (client) => {
        if (!(await markInvoiceOverdue(client, invoice.id))) return;
        await enqueue(client, 'overdue_email', { invoice_id: invoice.id }, `overdue:${invoice.id}`);
        await enqueue(
          client,
          'push',
          {
            title: 'Invoice overdue',
            message: `${engagement.reference} \u00b7 invoice ${invoice.number ?? ''} \u00b7 ${formatMoney(BigInt(invoice.amount_minor), invoice.currency)}`,
          },
          `push:overdue:${invoice.id}`,
        );
      });
    } catch (error) {
      if (!(error instanceof BillingUnavailable)) throw error;
    }
  }
};

export type CancelResult = {
  engagement: EngagementView;
  ledger_entries: LedgerEntryView[];
  refunds: { killbill_payment_id: string; amount_minor: number }[];
  voided_invoice_ids: string[];
  paid_minor: number;
  refunded_minor: number;
  retained_minor: number;
};

export const cancelWithRefund = async (
  engagementId: string,
  refundMinorRaw: unknown,
): Promise<CancelResult> => {
  const engagement = await findEngagement(engagementId);
  if (engagement === null) fail('not_found');
  const current = engagement as EngagementRow;

  if (!(await claimCancel(current.id))) fail('invalid_state');
  let completed = false;
  try {
    const transition = cancelTransition({
      state: current.state,
      finalsOut: current.finals_out,
      revisionMilestone: current.revision_milestone,
    });
    if ('error' in transition) fail(transition.error);

    const ledger = await listLedger(current.id);
    const payments: RefundablePayment[] = ledger
      .filter((entry) => entry.kind === 'deposit' || entry.kind === 'invoice_payment')
      .map((entry) => ({
        killbillPaymentId: entry.killbill_payment_id,
        amountMinor: BigInt(entry.amount_minor),
        refundedMinor: 0n,
        seq: BigInt(entry.seq),
      }));
    const paidMinor = payments.reduce((total, payment) => total + payment.amountMinor, 0n);

    if (
      typeof refundMinorRaw !== 'number' ||
      !Number.isInteger(refundMinorRaw) ||
      refundMinorRaw < 1 ||
      BigInt(refundMinorRaw) > paidMinor
    )
      validation({ refund_minor: FIELD_COPY.refund_minor });
    const refundMinor = BigInt(refundMinorRaw as number);

    const confirmed = new Map<string, bigint>();
    for (const payment of payments) {
      const kbPayment = await getPayment(payment.killbillPaymentId);
      const key = refundTransactionKey(current.id, payment.killbillPaymentId);
      const existing = (kbPayment?.transactions ?? []).find(
        (entry) =>
          entry.transactionType === 'REFUND' &&
          entry.status === 'SUCCESS' &&
          entry.transactionExternalKey === key,
      );
      if (existing !== undefined)
        confirmed.set(
          payment.killbillPaymentId,
          minorFromMajor(existing.amount, current.brand_currency),
        );
    }
    const alreadyRefunded = [...confirmed.values()].reduce((total, amount) => total + amount, 0n);
    if (alreadyRefunded > refundMinor) validation({ refund_minor: FIELD_COPY.refund_minor });

    const accountId = await ensureKillbillAccount(brandOf(current));

    for (const part of allocateRefund(payments, refundMinor)) {
      if (confirmed.has(part.killbillPaymentId)) continue;
      await refundPayment({
        paymentId: part.killbillPaymentId,
        amountMinor: part.amountMinor,
        currency: current.brand_currency,
        transactionExternalKey: refundTransactionKey(current.id, part.killbillPaymentId),
      });
      confirmed.set(part.killbillPaymentId, part.amountMinor);
      await transaction(async (client) => {
        await insertLedgerEntry(client, {
          id: randomUUID(),
          engagementId: current.id,
          kind: 'refund',
          amountMinor: part.amountMinor,
          currency: current.brand_currency,
          invoiceId: null,
          killbillPaymentId: part.killbillPaymentId,
          transactionKey: refundTransactionKey(current.id, part.killbillPaymentId),
        });
      });
    }

    const voidedIds: string[] = [];
    for (const invoice of await listInvoices(current.id)) {
      if (!isVoidable(invoice.status)) continue;
      if (invoice.killbill_invoice_id !== null) await voidInvoice(invoice.killbill_invoice_id);
      await transaction(async (client) => markInvoiceVoid(client, invoice.id));
      voidedIds.push(invoice.id);
    }

    if (!(await brandHasOverdueInvoice(current.brand_id))) {
      await setBlockingState(accountId, 'CLEAR');
      await setOverdueBlocked(current.brand_id, false);
    }

    const refundedMinor = [...confirmed.values()].reduce((total, amount) => total + amount, 0n);

    await transaction(async (client) => {
      await setEngagementPhase(client, current.id, {
        state: 'cancelled_with_refund',
        finalsOut: current.finals_out,
        revisionMilestone: current.revision_milestone,
      });
      await enqueue(
        client,
        'refund_email',
        { engagement_id: current.id, total_minor: refundedMinor.toString() },
        `refund:${current.id}`,
      );
    });
    await revokeReviewLinks(current.id);
    completed = true;

    const services = await servicesForRead();
    const rates = await listRates();
    const refreshed = await findEngagement(current.id);
    const bundle = await loadEngagementBundle(refreshed as EngagementRow, services, rates);
    const refundEntries = bundle.ledger.filter((entry) => entry.kind === 'refund');

    return {
      engagement: engagementView(bundle, 'studio'),
      ledger_entries: refundEntries.map(ledgerView),
      refunds: refundEntries.map((entry) => ({
        killbill_payment_id: entry.killbill_payment_id,
        amount_minor: Number(entry.amount_minor),
      })),
      voided_invoice_ids: voidedIds,
      paid_minor: Number(paidMinor),
      refunded_minor: Number(refundedMinor),
      retained_minor: Number(paidMinor - refundedMinor),
    };
  } finally {
    if (!completed) await releaseCancel(current.id);
  }
};
