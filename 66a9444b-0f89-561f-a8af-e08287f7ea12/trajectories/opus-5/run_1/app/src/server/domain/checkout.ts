import { config } from '../config.js';
import { many, one, type Queryable } from '../db/pool.js';
import { conflict, invalid } from '../lib/errors.js';
import { newId, newOrderRef } from '../lib/codes.js';
import { allocate, formatEuros, percentOf } from '../lib/money.js';
import { addSeconds, festivalDayOf } from '../lib/time.js';
import * as killbill from '../services/killbill.js';
import { deleteObject } from '../services/storage.js';
import { queueMail } from '../services/mail.js';
import { formatDate, formatDayLabel, formatDeadline } from './format.js';
import {
  dueInstant,
  invoiceNumber,
  newInvoiceId,
} from './invoices.js';
import { issuePass, passFileName, type LineRow, type OrderRow } from './orders.js';
import { loadEdition, loadPricePolicy, loadSessionForUpdate } from './programme.js';
import { liveHold } from './liveness.js';
import { recordPayment } from './payments.js';
import { convertHolds } from './seats.js';
import { lockVoucher, recordMovement, voucherBalance, voucherExists } from './vouchers.js';

export interface PassRequest {
  product: 'full_festival' | 'day';
  festival_day?: string;
}

export interface CheckoutRequest {
  hold_ids: string[];
  passes: PassRequest[];
  rate: 'full' | 'reduced';
  voucher_code: string | null;
  attendee_names: string[] | null;
}

export interface CheckoutCaller {
  id: string;
  name: string;
  email: string;
  role: string;
  organisationId: string | null;
}

interface DraftLine {
  position: number;
  kind: LineRow['kind'];
  sessionId: string | null;
  festivalDay: string | null;
  title: string;
  listCents: number;
  holderName: string;
}

const MAX_PASSES_PER_CHECKOUT = 30;
const GROUP_MINIMUM_TICKETS = 5;

/** Undoes artifacts stored outside Postgres when a checkout cannot commit. */
export interface Compensation {
  passKeys: string[];
  killBillPaymentId: string | null;
  killBillInvoiceId: string | null;
  orderRef: string | null;
}

export function newCompensation(): Compensation {
  return { passKeys: [], killBillPaymentId: null, killBillInvoiceId: null, orderRef: null };
}

export async function runCheckout(
  db: Queryable,
  caller: CheckoutCaller,
  request: CheckoutRequest,
  compensation: Compensation,
): Promise<OrderRow> {
  const isGroup = caller.role === 'group_booker';
  if (isGroup && request.rate === 'reduced') {
    throw invalid({ rate: 'not_for_groups' });
  }

  const edition = await loadEdition(db);
  const policy = await loadPricePolicy(db);
  const festivalDayDates = new Set(
    (
      await many<{ date: string }>(
        db,
        `SELECT generate_series($1::date, $2::date, '1 day')::date::text AS date`,
        [edition.first_day, edition.last_day],
      )
    ).map((row) => row.date),
  );

  if (request.passes.length > MAX_PASSES_PER_CHECKOUT) {
    throw invalid({ passes: 'too_many' });
  }

  const seatLines: DraftLine[] = [];
  const expiredHolds: string[] = [];
  const sortedHoldIds = [...new Set(request.hold_ids)];

  for (const holdId of sortedHoldIds) {
    const hold = await one<{
      id: string;
      session_id: string;
      quantity: number;
      live: boolean;
    }>(
      db,
      `SELECT h.id, h.session_id, h.quantity, (${liveHold('h')}) AS live FROM holds h
       WHERE h.id = $1 AND h.user_id = $2 FOR UPDATE`,
      [holdId, caller.id],
    );
    if (hold === null || !hold.live) {
      expiredHolds.push(holdId);
      continue;
    }
    const session = await loadSessionForUpdate(db, hold.session_id);
    if (session === null) {
      expiredHolds.push(holdId);
      continue;
    }
    if (session.effective_status === 'cancelled') {
      throw conflict('session_cancelled');
    }
    const price = request.rate === 'reduced' ? session.price_reduced_cents : session.price_full_cents;
    for (let seat = 0; seat < hold.quantity; seat += 1) {
      seatLines.push({
        position: 0,
        kind: 'seat',
        sessionId: session.id,
        festivalDay: festivalDayOf(session.starts_at),
        title: session.title,
        listCents: price ?? 0,
        holderName: caller.name,
      });
    }
  }

  if (expiredHolds.length > 0) {
    throw conflict('hold_expired', { hold_ids: expiredHolds });
  }

  const passLines: DraftLine[] = [];
  for (const pass of request.passes) {
    if (pass.product === 'full_festival') {
      passLines.push({
        position: 0,
        kind: 'full_festival',
        sessionId: null,
        festivalDay: null,
        title: 'Full-festival pass',
        listCents:
          request.rate === 'reduced'
            ? policy.full_festival_reduced_cents
            : policy.full_festival_full_cents,
        holderName: caller.name,
      });
      continue;
    }
    const day = pass.festival_day;
    if (day === undefined || !festivalDayDates.has(day)) {
      throw invalid({ passes: 'unknown_festival_day' });
    }
    passLines.push({
      position: 0,
      kind: 'day',
      sessionId: null,
      festivalDay: day,
      title: `Day pass, ${formatDayLabel(day)}`,
      listCents: request.rate === 'reduced' ? policy.day_reduced_cents : policy.day_full_cents,
      holderName: caller.name,
    });
  }

  const draftLines = [...seatLines, ...passLines].map((line, index) => ({
    ...line,
    position: index + 1,
  }));

  if (draftLines.length === 0) throw invalid({ items: 'empty' });

  if (isGroup) {
    if (draftLines.length < GROUP_MINIMUM_TICKETS) throw invalid({ items: 'group_minimum' });
    const names = request.attendee_names ?? [];
    if (names.length !== draftLines.length) throw invalid({ attendee_names: 'count_mismatch' });
    if (names.some((name) => name.trim().length === 0)) {
      throw invalid({ attendee_names: 'blank' });
    }
    draftLines.forEach((line, index) => {
      line.holderName = (names[index] as string).trim();
    });
  }

  const subtotal = draftLines.reduce((sum, line) => sum + line.listCents, 0);
  const groupDiscount = isGroup ? percentOf(subtotal, policy.group_discount_percent) : 0;
  const discountShares = allocate(
    groupDiscount,
    draftLines.map((line) => line.listCents),
  );

  let voucherAmount = 0;
  let voucherCode: string | null = null;
  if (request.voucher_code !== null && request.voucher_code.trim().length > 0) {
    const code = request.voucher_code.trim();
    if (!(await voucherExists(db, code))) throw invalid({ voucher_code: 'unknown' });
    await lockVoucher(db, code);
    const balance = await voucherBalance(db, code);
    if (balance <= 0) throw invalid({ voucher_code: 'empty' });
    voucherCode = code;
    voucherAmount = Math.min(balance, subtotal - groupDiscount);
  }

  const voucherShares = allocate(
    voucherAmount,
    draftLines.map((line, index) => line.listCents - (discountShares[index] as number)),
  );

  const total = subtotal - groupDiscount - voucherAmount;
  const orderId = newId();
  const ref = await uniqueOrderRef(db);
  compensation.orderRef = ref;
  const proofDeadline =
    request.rate === 'reduced'
      ? addSeconds(new Date(), config.times.proofDecisionSeconds)
      : null;

  await db.query(
    `INSERT INTO orders (id, ref, user_id, organisation_id, rate, subtotal_cents,
       group_discount_cents, voucher_code, voucher_cents, total_cents, proof_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      orderId,
      ref,
      caller.id,
      isGroup ? caller.organisationId : null,
      request.rate,
      subtotal,
      groupDiscount,
      voucherCode,
      voucherAmount,
      total,
      proofDeadline,
    ],
  );

  const lines: LineRow[] = [];
  for (const [index, draft] of draftLines.entries()) {
    const lineId = newId();
    const discountShare = discountShares[index] as number;
    const voucherShare = voucherShares[index] as number;
    const charged = draft.listCents - discountShare - voucherShare;
    await db.query(
      `INSERT INTO order_lines (id, order_id, position, kind, session_id, festival_day, title,
         holder_name, state, list_cents, group_discount_cents, voucher_cents, charged_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'held', $9, $10, $11, $12)`,
      [
        lineId,
        orderId,
        draft.position,
        draft.kind,
        draft.sessionId,
        draft.festivalDay,
        draft.title,
        draft.holderName,
        draft.listCents,
        discountShare,
        voucherShare,
        charged,
      ],
    );
    lines.push({
      id: lineId,
      order_id: orderId,
      position: draft.position,
      kind: draft.kind,
      session_id: draft.sessionId,
      festival_day: draft.festivalDay,
      title: draft.title,
      holder_name: draft.holderName,
      state: 'held',
      list_cents: draft.listCents,
      group_discount_cents: discountShare,
      voucher_cents: voucherShare,
      charged_cents: charged,
    });
  }

  if (voucherCode !== null && voucherAmount > 0) {
    await recordMovement(db, {
      kind: 'redeem',
      code: voucherCode,
      amountCents: voucherAmount,
      actor: caller.email,
      orderRef: ref,
    });
  }

  await convertHolds(db, sortedHoldIds);

  const order: OrderRow = {
    id: orderId,
    ref,
    user_id: caller.id,
    buyer_name: caller.name,
    buyer_email: caller.email,
    organisation_id: isGroup ? caller.organisationId : null,
    rate: request.rate,
    subtotal_cents: subtotal,
    group_discount_cents: groupDiscount,
    voucher_code: voucherCode,
    voucher_cents: voucherAmount,
    total_cents: total,
    proof_deadline: proofDeadline,
    killbill_account_id: null,
    killbill_payment_id: null,
    created_at: new Date(),
  };

  const passAttachments: Array<{ filename: string; key: string }> = [];
  const passesNow = request.rate === 'full';
  if (passesNow) {
    for (const line of lines) {
      const issued = await issuePass(db, order, line, line.holder_name);
      compensation.passKeys.push(issued.objectKey);
      passAttachments.push({ filename: passFileName(issued.code), key: issued.objectKey });
    }
  }

  if (isGroup) {
    const accountId = await ensureKillBillAccount(
      db,
      `kerf-org-${caller.organisationId as string}`,
      await organisationName(db, caller.organisationId as string),
      true,
    );
    const invoiceId = newInvoiceId();
    const created = await killbill.createInvoiceFromCharges(
      accountId,
      lines.map((line) => ({
        lineId: line.id,
        description: `${ref} \u00b7 ${line.title} \u00b7 ${line.holder_name}`,
        amountCents: line.charged_cents,
      })),
    );
    compensation.killBillInvoiceId = created.invoiceId;
    const number = await invoiceNumber(db);
    const issuedAt = new Date();
    const dueAt = dueInstant(issuedAt);
    const balanceIsZero = total <= 0;
    await db.query(
      `INSERT INTO invoices (id, number, organisation_id, order_id, status, amount_cents,
         issued_at, due_at, killbill_invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        invoiceId,
        number,
        caller.organisationId,
        orderId,
        balanceIsZero ? 'paid' : 'issued',
        total,
        issuedAt,
        dueAt,
        created.invoiceId,
      ],
    );
    for (const line of lines) {
      const item = created.items.find((candidate) => candidate.lineId === line.id);
      await db.query(
        `INSERT INTO invoice_items (id, invoice_id, line_id, description, amount_cents,
           killbill_invoice_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          invoiceId,
          line.id,
          `${ref} \u00b7 ${line.title} \u00b7 ${line.holder_name}`,
          line.charged_cents,
          item?.killBillItemId ?? null,
        ],
      );
    }
    await db.query(`UPDATE orders SET killbill_account_id = $2 WHERE id = $1`, [
      orderId,
      accountId,
    ]);
    await db.query(`UPDATE order_lines SET state = 'captured' WHERE order_id = $1`, [orderId]);

    await queueMail(db, {
      eventKey: `order-confirmation:${orderId}`,
      to: caller.email,
      subject: `Your Kerf Frequencies order ${ref}`,
      body: orderMailBody(ref, lines, subtotal, groupDiscount, voucherAmount, total, null),
      attachments: passAttachments,
    });
    await queueMail(db, {
      eventKey: `invoice-issued:${invoiceId}`,
      to: caller.email,
      subject: `Invoice ${number} from Kerf Collective`,
      body: [
        `Invoice ${number} for order ${ref}.`,
        '',
        ...lines.map(
          (line) => `${line.title} — ${line.holder_name} — ${formatEuros(line.charged_cents)}`,
        ),
        '',
        `Amount due: ${formatEuros(total)}`,
        `Due on ${formatDate(dueAt)}`,
      ].join('\n'),
    });
  } else {
    if (total > 0) {
      const accountId = await ensureKillBillAccount(
        db,
        `kerf-user-${caller.id}`,
        caller.name,
        false,
      );
      const authorised = await killbill.authorize(accountId, ref, total);
      compensation.killBillPaymentId = authorised.paymentId;
      await db.query(
        `UPDATE orders SET killbill_account_id = $2, killbill_payment_id = $3 WHERE id = $1`,
        [orderId, accountId, authorised.paymentId],
      );
      order.killbill_account_id = accountId;
      order.killbill_payment_id = authorised.paymentId;
      await recordPayment(db, { orderId, transaction: authorised.transaction });
      await db.query(`UPDATE order_lines SET state = 'authorised' WHERE order_id = $1`, [orderId]);

      if (request.rate === 'full') {
        const captured = await killbill.capture(authorised.paymentId, ref, total);
        await recordPayment(db, { orderId, transaction: captured });
      }
    }
    await db.query(`UPDATE order_lines SET state = $2 WHERE order_id = $1`, [
      orderId,
      request.rate === 'full' ? 'captured' : 'proof_pending',
    ]);

    await queueMail(db, {
      eventKey: `order-confirmation:${orderId}`,
      to: caller.email,
      subject: `Your Kerf Frequencies order ${ref}`,
      body: orderMailBody(
        ref,
        lines,
        subtotal,
        groupDiscount,
        voucherAmount,
        total,
        proofDeadline,
      ),
      attachments: passAttachments,
    });
  }

  return order;
}

function orderMailBody(
  ref: string,
  lines: readonly LineRow[],
  subtotal: number,
  groupDiscount: number,
  voucher: number,
  total: number,
  proofDeadline: Date | null,
): string {
  const rows = lines.map(
    (line) =>
      `${line.title} — ${line.holder_name} — ${formatEuros(line.list_cents)}` +
      (line.voucher_cents > 0 ? ` (voucher ${formatEuros(line.voucher_cents)})` : '') +
      (line.group_discount_cents > 0
        ? ` (group discount ${formatEuros(line.group_discount_cents)})`
        : ''),
  );
  const totals = [
    `Subtotal: ${formatEuros(subtotal)}`,
    ...(groupDiscount > 0 ? [`Group discount: ${formatEuros(groupDiscount)}`] : []),
    ...(voucher > 0 ? [`Gift voucher: ${formatEuros(voucher)}`] : []),
    `Total: ${formatEuros(total)}`,
  ];
  const proof =
    proofDeadline === null
      ? []
      : [
          '',
          `Upload your proof of reduced rate by ${formatDeadline(proofDeadline)}.`,
          `We hold your payment until then: /orders`,
        ];
  return [`Order ${ref}`, '', ...rows, '', ...totals, ...proof].join('\n');
}

async function organisationName(db: Queryable, organisationId: string): Promise<string> {
  const row = await one<{ name: string }>(db, `SELECT name FROM organisations WHERE id = $1`, [
    organisationId,
  ]);
  return row?.name ?? organisationId;
}

export async function ensureKillBillAccount(
  db: Queryable,
  externalKey: string,
  name: string,
  blockAutoPay: boolean,
): Promise<string> {
  const known = await one<{ killbill_account_id: string }>(
    db,
    `SELECT killbill_account_id FROM killbill_accounts WHERE external_key = $1`,
    [externalKey],
  );
  if (known !== null) return known.killbill_account_id;
  const accountId = await killbill.ensureAccount(externalKey, name, blockAutoPay);
  await db.query(
    `INSERT INTO killbill_accounts (external_key, killbill_account_id) VALUES ($1, $2)
     ON CONFLICT (external_key) DO NOTHING`,
    [externalKey, accountId],
  );
  return accountId;
}

async function uniqueOrderRef(db: Queryable): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ref = newOrderRef();
    const clash = await one<{ ref: string }>(db, `SELECT ref FROM orders WHERE ref = $1`, [ref]);
    if (clash === null) return ref;
  }
  throw new Error('could not allocate an order ref');
}

/** Removes the artifacts a failed checkout may already have created outside Postgres. */
export async function compensate(compensation: Compensation): Promise<void> {
  for (const key of compensation.passKeys) {
    try {
      await deleteObject(key);
    } catch {
      // the storage outage that caused the rollback may still be in place
    }
  }
  if (compensation.killBillPaymentId !== null && compensation.orderRef !== null) {
    try {
      await killbill.voidPayment(compensation.killBillPaymentId, compensation.orderRef);
    } catch {
      // the payment outage that caused the rollback may still be in place
    }
  }
  if (compensation.killBillInvoiceId !== null) {
    try {
      await killbill.voidInvoice(compensation.killBillInvoiceId);
    } catch {
      // the payment outage that caused the rollback may still be in place
    }
  }
}
