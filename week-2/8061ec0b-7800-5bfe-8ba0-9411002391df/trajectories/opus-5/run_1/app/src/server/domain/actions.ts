import { contractMonthOf, formatMoney, formatTaxPercent, splitPayment } from '../../shared/money';
import { instrumentLabel, reversalReasonWord } from '../../shared/labels';
import { formatStoreDate, formatStoreDateTime, isoSeconds, storeDateOf } from '../../shared/time';
import {
  STRING_SIZES,
  type Contract,
  type ContractTerms,
  type InstrumentType,
  type Payment,
  type Reversal,
  type ReversalReason,
  type Size,
  type User,
} from '../../shared/types';
import { now, storeToday } from '../clock';
import { config } from '../config';
import { pool, tx } from '../db';
import {
  conflict,
  invalidTransition,
  notFound,
  storageUnavailable,
  unavailableConflict,
  validationFailed,
} from '../errors';
import { randomId, randomToken } from '../ids';
import { buildAgreementPdf, buildBillOfSalePdf } from '../services/documents';
import {
  buyoutExternalKey,
  cancelSubscriptionAndConfirm,
  ensureAccount,
  ensureSubscription,
  findPayment,
  paymentExternalKey,
  purchaseOnce,
  refundOnce,
  reversalTransactionKey,
} from '../services/killbill';
import { queueEmail } from '../services/mail';
import {
  agreementKey,
  billOfSaleKey,
  checkStorageReachable,
  copyObject,
  deleteObject,
  objectExists,
  putObject,
} from '../services/storage';
import {
  addEquityEntry,
  alternativesFor,
  buildContract,
  claimInstrument,
  equityOf,
  loadContractRow,
  moveContract,
  nextContractId,
  newestSigningLink,
  termsOf,
  type ContractRow,
} from './contracts';
import {
  lookupIdempotency,
  raiseIdempotencyConflict,
  requestHash,
  storeIdempotentAnswer,
  validateIdempotencyKey,
  type IdempotencyState,
  type IdempotentEndpoint,
} from './idempotency';
import { computeQuote, contractTerms, priceListInForce, type Db } from './pricing';
import { deliveryDateFor, schoolRow } from './schools';

export interface ParentContact {
  name: string;
  email: string;
}

export async function parentOf(db: Db, familyId: string): Promise<ParentContact> {
  const { rows } = await db.query<{ parent_name: string; email: string }>(
    'select parent_name, email from families where id = $1',
    [familyId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`family ${familyId} is missing`);
  return { name: row.parent_name, email: row.email };
}

export interface ActionContext {
  row: ContractRow;
  terms: ContractTerms;
  equity: number;
  today: string;
  parent: ParentContact;
}

export async function loadActionContext(db: Db, contractId: string): Promise<ActionContext> {
  const row = await loadContractRow(db, contractId);
  if (row === null) throw notFound();
  const today = storeToday();
  const [terms, equity, parent] = await Promise.all([
    termsOf(db, row, today),
    equityOf(db, row.id),
    parentOf(db, row.family_id),
  ]);
  return { row, terms, equity, today, parent };
}

/** Makes sure the contract's Kill Bill account and subscription exist, reusing any found by key. */
async function ensureBilling(row: ContractRow, parentName: string): Promise<{ accountId: string; subscriptionId: string }> {
  const accountId = await ensureAccount(row.id, parentName);
  const subscriptionId = await ensureSubscription(row.id, accountId);
  if (row.kb_account_id !== accountId || row.kb_subscription_id !== subscriptionId) {
    await pool.query(
      "update contracts set kb_account_id = $2, kb_subscription_id = $3, subscription_state = coalesce(subscription_state, 'active') where id = $1",
      [row.id, accountId, subscriptionId],
    );
  }
  return { accountId, subscriptionId };
}

async function closeSubscription(row: ContractRow, parentName: string): Promise<void> {
  const { subscriptionId } = await ensureBilling(row, parentName);
  await cancelSubscriptionAndConfirm(subscriptionId);
}

/** Generates the stored agreement PDF a seeded contract reports but has not written yet. */
export async function ensureAgreementObject(context: ActionContext): Promise<void> {
  const key = agreementKey(context.row.id);
  if (await objectExists(key)) return;
  const signedAt = context.row.signed_at ?? context.row.created_at;
  const pdf = buildAgreementPdf({
    contractId: context.row.id,
    studentName: context.row.student_name,
    serial: context.row.serial,
    instrumentLabel: instrumentLabel(context.row.instrument_type, context.row.size),
    terms: context.terms,
    waiver: context.row.waiver,
    taxRateBpAtSigning: context.terms.tax_rate_bp,
    fullName: context.parent.name,
    signedAt,
  });
  await putObject(key, pdf, 'application/pdf');
}

// ---------------------------------------------------------------------------
// Reservations

export async function createReservation(
  user: User,
  body: unknown,
): Promise<Contract> {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const studentId = typeof raw.student_id === 'string' ? raw.student_id : '';
  const at = now();
  const today = storeDateOf(at);

  return tx(async (sql) => {
    const { rows: students } = await sql.query<{ id: string; family_id: string; school_id: string }>(
      'select id, family_id, school_id from students where id = $1',
      [studentId],
    );
    const student = students[0];
    if (student === undefined || student.family_id !== user.family_id) throw notFound();

    const { rows: open } = await sql.query<{ count: string }>(
      "select count(*)::text as count from contracts where student_id = $1 and status in ('reserved','agreement_sent','signed','active')",
      [student.id],
    );
    if (Number(open[0]?.count ?? '0') > 0) {
      throw conflict('student_has_instrument', 'That student already has an instrument on contract.');
    }

    const fields: Record<string, string> = {};
    const type = raw.instrument_type;
    const size = raw.size;
    const waiver = raw.waiver;
    const typeValid = type === 'flute' || type === 'clarinet' || type === 'trumpet' || type === 'violin' || type === 'cello';
    if (!typeValid) fields.instrument_type = 'Choose one of the five instruments.';
    const stringed = type === 'violin' || type === 'cello';
    const sizeValid = typeValid && (stringed ? STRING_SIZES.includes(size as never) : size === 'full');
    if (!sizeValid) fields.size = 'Choose a size this instrument comes in.';
    if (typeof waiver !== 'boolean') fields.waiver = 'Say whether the waiver is included.';
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const instrumentType = type as InstrumentType;
    const serial = await claimInstrument(sql, instrumentType, size as Size);
    if (serial === null) throw unavailableConflict(await alternativesFor(sql, instrumentType));

    const school = await schoolRow(sql, student.school_id);
    if (school === null) throw new Error('student without a school');
    const priceList = await priceListInForce(sql, today);
    if (priceList === null) throw new Error('no price list in force');
    const contractId = await nextContractId(sql);
    const holdExpiresAt = new Date(at.getTime() + config.reservationHoldSeconds * 1000);
    await sql.query(
      `insert into contracts (id, status, student_id, serial, waiver, price_list_id, bound, delivery_date,
         hold_expires_at, created_at, agreement_stored, bill_of_sale_stored)
       values ($1,'reserved',$2,$3,$4,$5,false,$6,$7,$8,false,false)`,
      [
        contractId,
        student.id,
        serial,
        waiver,
        priceList.id,
        deliveryDateFor(school.delivery_weekday, at),
        holdExpiresAt,
        at,
      ],
    );
    await sql.query(
      'insert into contract_history (contract_id, from_status, to_status, at, actor, actor_name) values ($1,null,$2,$3,$4,$5)',
      [contractId, 'reserved', at, 'parent', user.name],
    );
    const row = await loadContractRow(sql, contractId);
    if (row === null) throw new Error('reservation vanished');
    return buildContract(sql, row, today);
  });
}

// ---------------------------------------------------------------------------
// Signing links

export async function sendSigningLink(user: User, context: ActionContext): Promise<Contract> {
  const { row } = context;
  if (row.status !== 'reserved' && row.status !== 'agreement_sent') throw invalidTransition();
  const at = now();
  const holdDeadline = row.hold_expires_at;
  if (holdDeadline === null) throw invalidTransition();
  const ttlExpiry = new Date(at.getTime() + config.signingLinkTtlSeconds * 1000);
  const expiresAt = new Date(Math.min(ttlExpiry.getTime(), holdDeadline.getTime()));
  const token = randomToken();
  return tx(async (sql) => {
    await sql.query("update signing_links set status = 'revoked' where contract_id = $1 and status = 'live'", [row.id]);
    await sql.query(
      "insert into signing_links (token, contract_id, created_at, expires_at, status) values ($1,$2,$3,$4,'live')",
      [token, row.id, at, expiresAt],
    );
    await moveContract(sql, row, 'agreement_sent', { at, actor: 'owner', actorName: user.name });
    await queueEmail(sql, {
      dedupeKey: `signing-${token}`,
      recipient: context.parent.email,
      subject: `Sign your rental agreement — ${row.student_name}, ${instrumentLabel(row.instrument_type, row.size)}`,
      body: [
        `${context.parent.name},`,
        '',
        `Please sign the rental agreement for ${row.student_name} (${instrumentLabel(row.instrument_type, row.size)}, serial ${row.serial}).`,
        '',
        `${config.publicUrl}/sign/${token}`,
        '',
        `This link works until ${formatStoreDateTime(expiresAt)}.`,
        '',
        'Keel & Bell Music',
      ].join('\n'),
    });
    const updated = await loadContractRow(sql, row.id);
    if (updated === null) throw notFound();
    return buildContract(sql, updated, context.today);
  });
}

export async function revokeSigningLink(context: ActionContext): Promise<Contract> {
  const { row } = context;
  const at = now();
  return tx(async (sql) => {
    const link = await newestSigningLink(sql, row.id);
    const live = link !== null && link.status === 'live' && link.expires_at.getTime() > at.getTime();
    if (!live) throw conflict('no_live_link', 'There is no live signing link to revoke.');
    await sql.query("update signing_links set status = 'revoked' where token = $1", [link.token]);
    const updated = await loadContractRow(sql, row.id);
    if (updated === null) throw notFound();
    return buildContract(sql, updated, context.today);
  });
}

export async function signAgreement(
  token: string,
  context: ActionContext,
  fullName: string,
): Promise<{ contract_id: string; status: 'signed'; signed_at: string }> {
  const at = now();
  const today = storeDateOf(at);
  const { row } = context;
  const boundList = await priceListInForce(pool, today);
  if (boundList === null) throw new Error('no price list in force');
  const terms = contractTerms(boundList, true, row.instrument_type, boundList.tax_rate_bp);
  const pdf = buildAgreementPdf({
    contractId: row.id,
    studentName: row.student_name,
    serial: row.serial,
    instrumentLabel: instrumentLabel(row.instrument_type, row.size),
    terms,
    waiver: row.waiver,
    taxRateBpAtSigning: boundList.tax_rate_bp,
    fullName,
    signedAt: at,
  });
  await putObject(agreementKey(row.id), pdf, 'application/pdf');
  return tx(async (sql) => {
    await moveContract(sql, row, 'signed', {
      at,
      actor: 'parent',
      actorName: fullName,
      extra: {
        price_list_id: boundList.id,
        bound: true,
        signed_at: at,
        agreement_stored: true,
      },
    });
    await sql.query("update signing_links set status = 'used' where token = $1", [token]);
    return { contract_id: row.id, status: 'signed' as const, signed_at: isoSeconds(at) };
  });
}

// ---------------------------------------------------------------------------
// Activation and closing moves

export async function activateContract(user: User, context: ActionContext): Promise<Contract> {
  const { row } = context;
  if (row.status !== 'signed') throw invalidTransition();
  if (!(await objectExists(agreementKey(row.id)))) {
    throw conflict('agreement_not_stored', 'The signed agreement is not stored yet.');
  }
  const { accountId, subscriptionId } = await ensureBilling(row, context.parent.name);
  const at = now();
  return tx(async (sql) => {
    const { rows } = await sql.query<{ status: string }>('select status from contracts where id = $1 for update', [
      row.id,
    ]);
    if (rows[0]?.status !== 'signed') throw invalidTransition();
    await moveContract(sql, row, 'active', {
      at,
      actor: 'owner',
      actorName: user.name,
      extra: {
        activated_at: at,
        billing_anchor_date: storeDateOf(at),
        subscription_state: 'active',
        kb_account_id: accountId,
        kb_subscription_id: subscriptionId,
      },
    });
    const updated = await loadContractRow(sql, row.id);
    if (updated === null) throw notFound();
    return buildContract(sql, updated, context.today);
  });
}

export async function closeContract(
  user: User,
  context: ActionContext,
  to: 'returned' | 'written_off',
): Promise<Contract> {
  const { row } = context;
  if (row.status !== 'active') throw invalidTransition();
  await closeSubscription(row, context.parent.name);
  const at = now();
  return tx(async (sql) => {
    await moveContract(sql, row, to, {
      at,
      actor: 'owner',
      actorName: user.name,
      closedAt: at,
      extra: { subscription_state: 'cancelled' },
    });
    const updated = await loadContractRow(sql, row.id);
    if (updated === null) throw notFound();
    return buildContract(sql, updated, context.today);
  });
}

// ---------------------------------------------------------------------------
// Money actions

export interface IdempotentRequest {
  key: string;
  state: IdempotencyState;
  hash: string;
}

export async function beginIdempotent(
  contractId: string,
  endpoint: IdempotentEndpoint,
  headerKey: unknown,
  bodyParts: unknown,
): Promise<{ replay: { status: number; body: unknown } | null; state: IdempotencyState; hash: string }> {
  const hash = requestHash(bodyParts);
  const key = typeof headerKey === 'string' && headerKey.length > 0 ? headerKey : null;
  const state = await lookupIdempotency(contractId, endpoint, key, hash);
  return { replay: state.replay, state, hash };
}

function waiverAmount(terms: ContractTerms, waiver: boolean): number {
  return waiver ? terms.waiver_cents : 0;
}

export async function recordPayment(
  user: User,
  context: ActionContext,
  body: unknown,
  state: IdempotencyState,
  hash: string,
): Promise<{ payment: Payment; contract: Contract }> {
  const { row, terms } = context;
  if (row.status !== 'active') throw invalidTransition();
  raiseIdempotencyConflict(state);
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const key = validateIdempotencyKey(state.key === '' ? undefined : state.key);
  const amount = raw.amount_cents;
  if (!(typeof amount === 'number' && Number.isInteger(amount) && amount >= 1 && amount <= 1000000)) {
    throw validationFailed({ amount_cents: 'Enter a whole number of cents from 1 to 1,000,000.' });
  }
  const split = splitPayment(amount, terms.base_rent_cents, waiverAmount(terms, row.waiver), terms.tax_rate_bp);
  const remaining = terms.purchase_price_cents - context.equity;
  if (split.base_rent_cents > remaining) throw validationFailed({ amount_cents: 'exceeds_remaining' });

  const paysOff = split.base_rent_cents === remaining;
  const at = now();
  const billOfSale = billOfSaleKey(row.id);
  if (paysOff) {
    await checkStorageReachable();
    await putObject(
      billOfSale,
      buildBillOfSalePdf({
        contractId: row.id,
        parentName: context.parent.name,
        studentName: row.student_name,
        instrumentLabel: instrumentLabel(row.instrument_type, row.size),
        serial: row.serial,
        amountPaidCents: amount,
        closedAt: at,
      }),
      'application/pdf',
    );
  }

  try {
    const { accountId } = await ensureBilling(row, context.parent.name);
    const externalKey = paymentExternalKey(row.id, key);
    const { killbillPaymentId } = await purchaseOnce(accountId, externalKey, amount);
    if (paysOff) await closeSubscription(row, context.parent.name);

    const paymentId = randomId('PMT');
    return await tx(async (sql) => {
      await sql.query(
        `insert into payments (id, contract_id, amount_cents, base_rent_cents, waiver_cents, tax_cents,
           killbill_payment_id, kb_payment_external_key, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          paymentId,
          row.id,
          amount,
          split.base_rent_cents,
          split.waiver_cents,
          split.tax_cents,
          killbillPaymentId,
          externalKey,
          at,
        ],
      );
      await addEquityEntry(sql, row.id, 'payment', split.base_rent_cents, at, { paymentId });
      const newEquity = context.equity + split.base_rent_cents;
      if (paysOff) {
        await moveContract(sql, row, 'paid_off', {
          at,
          actor: 'owner',
          actorName: user.name,
          closedAt: at,
          extra: { bill_of_sale_stored: true, subscription_state: 'cancelled' },
        });
      }
      const contractMonth = contractMonthOf(newEquity, terms.base_rent_cents);
      await queueEmail(sql, {
        dedupeKey: `receipt-${paymentId}`,
        recipient: context.parent.email,
        subject: `Payment received — ${row.id}`,
        body: [
          `Payment received on ${row.id}.`,
          '',
          `Amount charged: ${formatMoney(amount)}`,
          `Rent toward ownership: ${formatMoney(split.base_rent_cents)}`,
          `Waiver: ${formatMoney(split.waiver_cents)}`,
          `Sales tax at ${formatTaxPercent(terms.tax_rate_bp)}: ${formatMoney(split.tax_cents)}`,
          `New equity: ${formatMoney(newEquity)}`,
          '',
          `${config.publicUrl}/contracts/${row.id}?month=${contractMonth}`,
          '',
          'Keel & Bell Music',
        ].join('\n'),
      });
      if (paysOff) {
        await queueOwnershipLetter(sql, context, amount);
      }
      const updated = await loadContractRow(sql, row.id);
      if (updated === null) throw notFound();
      const contract = await buildContract(sql, updated, context.today);
      const payment: Payment = {
        id: paymentId,
        amount_cents: amount,
        base_rent_cents: split.base_rent_cents,
        waiver_cents: split.waiver_cents,
        tax_cents: split.tax_cents,
        killbill_payment_id: killbillPaymentId,
        created_at: isoSeconds(at),
      };
      await storeIdempotentAnswer(sql, { contractId: row.id, endpoint: 'payments', key }, hash, {
        status: 201,
        body: JSON.stringify({ payment, contract }),
      });
      return { payment, contract };
    });
  } catch (error) {
    if (paysOff) await deleteObjectQuietly(billOfSale);
    throw error;
  }
}

async function deleteObjectQuietly(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch {
    /* the outage answer already says nothing was changed */
  }
}

async function queueOwnershipLetter(sql: Db, context: ActionContext, amountPaidCents: number): Promise<void> {
  const { row, terms } = context;
  await queueEmail(sql, {
    dedupeKey: `ownership-${row.id}`,
    recipient: context.parent.email,
    subject: `You own it — ${instrumentLabel(row.instrument_type, row.size)} ${row.serial}`,
    body: [
      `${row.student_name} now owns the ${instrumentLabel(row.instrument_type, row.size)}, serial ${row.serial}.`,
      '',
      `Purchase price: ${formatMoney(terms.purchase_price_cents)}`,
      `Amount paid at close: ${formatMoney(amountPaidCents)}`,
      '',
      `Bill of sale: ${config.publicUrl}/api/contracts/${row.id}/bill-of-sale.pdf`,
      '',
      'Keel & Bell Music',
    ].join('\n'),
  });
}

export async function reversePayment(
  context: ActionContext,
  paymentId: string,
  body: unknown,
  state: IdempotencyState,
  hash: string,
): Promise<{ reversal: Reversal; contract: Contract }> {
  const { row } = context;
  const { rows: payments } = await pool.query<{
    id: string;
    amount_cents: number;
    base_rent_cents: number;
    waiver_cents: number;
    tax_cents: number;
    killbill_payment_id: string;
    kb_payment_external_key: string;
    reversed: boolean;
  }>(
    'select id, amount_cents, base_rent_cents, waiver_cents, tax_cents, killbill_payment_id, kb_payment_external_key, reversed from payments where id = $1 and contract_id = $2',
    [paymentId, row.id],
  );
  const payment = payments[0];
  if (payment === undefined) throw notFound();
  if (row.status !== 'active') throw invalidTransition();
  raiseIdempotencyConflict(state);
  if (payment.reversed) throw conflict('payment_reversed', `Payment ${paymentId} was already reversed.`);
  const key = validateIdempotencyKey(state.key === '' ? undefined : state.key);
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const reason = raw.reason;
  if (reason !== 'returned_check' && reason !== 'chargeback' && reason !== 'entered_in_error') {
    throw validationFailed({ reason: 'Choose a reason for the reversal.' });
  }

  const { killbillRefundId } = await refundOnce(
    payment.kb_payment_external_key,
    payment.killbill_payment_id,
    reversalTransactionKey(row.id, paymentId),
    payment.amount_cents,
  );

  const at = now();
  const reversalId = randomId('REV');
  return tx(async (sql) => {
    await sql.query(
      `insert into reversals (id, payment_id, contract_id, reason, amount_cents, base_rent_cents, waiver_cents,
         tax_cents, killbill_refund_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        reversalId,
        paymentId,
        row.id,
        reason,
        payment.amount_cents,
        payment.base_rent_cents,
        payment.waiver_cents,
        payment.tax_cents,
        killbillRefundId,
        at,
      ],
    );
    await sql.query('update payments set reversed = true where id = $1', [paymentId]);
    await addEquityEntry(sql, row.id, 'reversal', -payment.base_rent_cents, at, { paymentId });
    const newEquity = context.equity - payment.base_rent_cents;
    await queueEmail(sql, {
      dedupeKey: `reversal-${reversalId}`,
      recipient: context.parent.email,
      subject: `Payment reversed — ${row.id}`,
      body: [
        `Payment ${paymentId} on ${row.id} was reversed.`,
        '',
        `Reason: ${reversalReasonWord(reason)}`,
        `Amount refunded: ${formatMoney(payment.amount_cents)}`,
        `Rent toward ownership: ${formatMoney(payment.base_rent_cents)}`,
        `Waiver: ${formatMoney(payment.waiver_cents)}`,
        `Sales tax: ${formatMoney(payment.tax_cents)}`,
        `Equity removed: ${formatMoney(payment.base_rent_cents)}`,
        `New equity: ${formatMoney(newEquity)}`,
        '',
        `${config.publicUrl}/contracts/${row.id}`,
        '',
        'Keel & Bell Music',
      ].join('\n'),
    });
    const updated = await loadContractRow(sql, row.id);
    if (updated === null) throw notFound();
    const contract = await buildContract(sql, updated, context.today);
    const reversal: Reversal = {
      id: reversalId,
      payment_id: paymentId,
      reason: reason as ReversalReason,
      amount_cents: payment.amount_cents,
      base_rent_cents: payment.base_rent_cents,
      waiver_cents: payment.waiver_cents,
      tax_cents: payment.tax_cents,
      killbill_refund_id: killbillRefundId,
      created_at: isoSeconds(at),
    };
    await storeIdempotentAnswer(sql, { contractId: row.id, endpoint: 'reversal', key }, hash, {
      status: 201,
      body: JSON.stringify({ reversal, contract }),
    });
    return { reversal, contract };
  });
}


export async function buyoutContract(
  user: User,
  context: ActionContext,
  body: unknown,
  state: IdempotencyState,
  hash: string,
): Promise<{ contract: Contract; buyout: Record<string, unknown> }> {
  const { row, terms } = context;
  if (row.status !== 'active') throw invalidTransition();
  raiseIdempotencyConflict(state);
  const key = validateIdempotencyKey(state.key === '' ? undefined : state.key);
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const expected = raw.expected_payoff_cents;
  if (!(typeof expected === 'number' && Number.isInteger(expected))) {
    throw validationFailed({ expected_payoff_cents: 'Send the payoff you are confirming, in whole cents.' });
  }
  const month = contractMonthOf(context.equity, terms.base_rent_cents);
  const quote = computeQuote(row.id, terms, context.equity, month, month, context.today);
  if (expected !== quote.payoff_cents) {
    throw conflict('quote_changed', 'The payoff has changed since that quote.', { quote });
  }

  const at = now();
  const key2 = billOfSaleKey(row.id);
  await checkStorageReachable();
  await putObject(
    key2,
    buildBillOfSalePdf({
      contractId: row.id,
      parentName: context.parent.name,
      studentName: row.student_name,
      instrumentLabel: instrumentLabel(row.instrument_type, row.size),
      serial: row.serial,
      amountPaidCents: quote.total_cents,
      closedAt: at,
    }),
    'application/pdf',
  );
  try {
    const { accountId } = await ensureBilling(row, context.parent.name);
    const { killbillPaymentId } = await purchaseOnce(accountId, buyoutExternalKey(row.id), quote.total_cents);
    await closeSubscription(row, context.parent.name);
    return await tx(async (sql) => {
      await addEquityEntry(sql, row.id, 'buyout', quote.remaining_cents, at);
      await moveContract(sql, row, 'paid_off', {
        at,
        actor: user.role === 'parent' ? 'parent' : 'owner',
        actorName: user.name,
        closedAt: at,
        extra: { bill_of_sale_stored: true, subscription_state: 'cancelled' },
      });
      await queueOwnershipLetter(sql, context, quote.total_cents);
      const updated = await loadContractRow(sql, row.id);
      if (updated === null) throw notFound();
      const contract = await buildContract(sql, updated, context.today);
      const buyout = {
        payoff_cents: quote.payoff_cents,
        discount_cents: quote.discount_cents,
        remaining_cents: quote.remaining_cents,
        tax_cents: quote.tax_cents,
        total_cents: quote.total_cents,
        tier: quote.tier,
        killbill_payment_id: killbillPaymentId,
      };
      await storeIdempotentAnswer(sql, { contractId: row.id, endpoint: 'buyout', key }, hash, {
        status: 200,
        body: JSON.stringify({ contract, buyout }),
      });
      return { contract, buyout };
    });
  } catch (error) {
    await deleteObjectQuietly(key2);
    throw error;
  }
}

export async function exchangeSize(
  user: User,
  context: ActionContext,
  body: unknown,
  state: IdempotencyState,
  hash: string,
): Promise<{ old_contract: Contract; new_contract: Contract; transfer_id: string }> {
  const { row } = context;
  if (row.status !== 'active') throw invalidTransition();
  if (row.instrument_type !== 'violin' && row.instrument_type !== 'cello') {
    throw conflict('not_exchangeable', 'Only violins and cellos can be exchanged for another size.');
  }
  raiseIdempotencyConflict(state);
  const key = validateIdempotencyKey(state.key === '' ? undefined : state.key);
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const size = raw.size;
  const sizeIndex = STRING_SIZES.indexOf(size as never);
  const currentIndex = STRING_SIZES.indexOf(row.size as never);
  if (sizeIndex === -1 || sizeIndex <= currentIndex) {
    throw validationFailed({ size: 'Choose a larger size of the same instrument.' });
  }

  const at = now();
  const newSize = size as Size;
  const claimed = await tx(async (sql) => {
    const serial = await claimInstrument(sql, row.instrument_type, newSize);
    if (serial === null) throw unavailableConflict(await alternativesFor(sql, row.instrument_type));
    const successorId = await nextContractId(sql);
    return { serial, successorId };
  });

  const successorAgreement = agreementKey(claimed.successorId);
  try {
    await ensureAgreementObject(context);
    await copyObject(agreementKey(row.id), successorAgreement);
    await closeSubscription(row, context.parent.name);
    const successorAccount = await ensureAccount(claimed.successorId, context.parent.name);
    const successorSubscription = await ensureSubscription(claimed.successorId, successorAccount);

    const transferId = randomId('TRF');
    return await tx(async (sql) => {
      await sql.query(
        `insert into contracts (id, status, student_id, serial, waiver, price_list_id, bound, delivery_date,
           hold_expires_at, signed_at, activated_at, billing_anchor_date, predecessor_id, subscription_state,
           agreement_stored, bill_of_sale_stored, kb_account_id, kb_subscription_id, created_at)
         values ($1,'active',$2,$3,$4,$5,true,$6,null,$7,$8,$9,$10,'active',true,false,$11,$12,$13)`,
        [
          claimed.successorId,
          row.student_id,
          claimed.serial,
          row.waiver,
          row.price_list_id,
          deliveryDateFor((await schoolRow(sql, row.school_id))?.delivery_weekday ?? 2, at),
          row.signed_at,
          row.activated_at,
          row.billing_anchor_date,
          row.id,
          successorAccount,
          successorSubscription,
          at,
        ],
      );
      await sql.query(
        'insert into contract_history (contract_id, from_status, to_status, at, actor, actor_name) values ($1,null,$2,$3,$4,$5)',
        [claimed.successorId, 'active', at, 'owner', user.name],
      );
      await moveContract(sql, row, 'exchanged', {
        at,
        actor: 'owner',
        actorName: user.name,
        closedAt: at,
        extra: { successor_id: claimed.successorId, subscription_state: 'cancelled' },
      });
      await addEquityEntry(sql, row.id, 'exchange_out', -context.equity, at, { transferId });
      await addEquityEntry(sql, claimed.successorId, 'exchange_in', context.equity, at, { transferId });
      const oldRow = await loadContractRow(sql, row.id);
      const newRow = await loadContractRow(sql, claimed.successorId);
      if (oldRow === null || newRow === null) throw notFound();
      const oldContract = await buildContract(sql, oldRow, context.today);
      const newContract = await buildContract(sql, newRow, context.today);
      await storeIdempotentAnswer(sql, { contractId: row.id, endpoint: 'exchange', key }, hash, {
        status: 201,
        body: JSON.stringify({ old_contract: oldContract, new_contract: newContract, transfer_id: transferId }),
      });
      return { old_contract: oldContract, new_contract: newContract, transfer_id: transferId };
    });
  } catch (error) {
    await deleteObjectQuietly(successorAgreement);
    await tx(async (sql) => {
      await sql.query("update instruments set status = 'available' where serial = $1", [claimed.serial]);
    });
    throw error;
  }
}

export function deliveryNoticeBody(
  schoolName: string,
  date: string,
  students: Array<{ student_name: string; instrument_label: string; serial: string }>,
): string {
  return [
    `Delivery day ${formatStoreDate(date)} — ${schoolName}`,
    '',
    ...students.map((entry) => `${entry.student_name} — ${entry.instrument_label} — ${entry.serial}`),
    '',
    'Keel & Bell Music',
  ].join('\n');
}
