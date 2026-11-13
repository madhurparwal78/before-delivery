import { declineCopy, errorCopy, fieldCopy, plateFor } from '../shared/copy.js';
import type { CheckoutReply, PaymentMethod } from '../shared/types.js';
import { announceBox, checkStockThresholds, moveBox, syncSearch } from './boxes.js';
import { businessNow, realNow } from './clock.js';
import { config } from './config.js';
import { formatCopenhagenLocal, thirdBankingDayDeadline } from './copenhagen.js';
import { inTransaction, query } from './db.js';
import { price, saleSplit } from './domain.js';
import { sendAuthorisationNotice, sendTransferInstructions } from './emails.js';
import { ApiError, fail, failForBox, failValidation } from './errors.js';
import { consumeHold, holdRemainingMs } from './holds.js';
import {
  loadOrder,
  loadOrderByHold,
  newReference,
  newToken,
  updateOrder,
  type OrderRow,
} from './orders.js';
import { claimAuthorised, ensureLedgerAccount, requireLedger, voidTooLate } from './payments.js';
import { rateAt } from './rates.js';
import * as gateway from './services/gateway.js';

export interface CheckoutBody {
  number: number;
  method: PaymentMethod;
  buyer: { name: string; email: string };
  address: { street: string; postcode: string; city: string };
  gift: { recipientName: string; recipientEmail: string; message: string } | null;
  card?: { number: string; expiry: string; cvc: string };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateCheckout(raw: Record<string, unknown>): CheckoutBody {
  const fields: Record<string, string> = {};
  const buyer = (raw.buyer ?? {}) as Record<string, unknown>;
  const address = (raw.address ?? {}) as Record<string, unknown>;
  const gift = raw.gift === null || raw.gift === undefined ? null : (raw.gift as Record<string, unknown>);
  const card = (raw.card ?? {}) as Record<string, unknown>;
  const method: PaymentMethod = raw.method === 'bank' ? 'bank' : 'card';
  const number = raw.number;

  if (text(buyer.name) === '') fields['buyer.name'] = fieldCopy['buyer.name'];
  if (!EMAIL.test(text(buyer.email))) fields['buyer.email'] = fieldCopy['buyer.email'];
  if (text(address.street) === '') fields['address.street'] = fieldCopy['address.street'];
  if (!/^\d{4}$/.test(text(address.postcode))) fields['address.postcode'] = fieldCopy['address.postcode'];
  if (text(address.city) === '') fields['address.city'] = fieldCopy['address.city'];

  if (gift !== null) {
    if (text(gift.recipientName) === '') fields['gift.recipientName'] = fieldCopy['gift.recipientName'];
    if (!EMAIL.test(text(gift.recipientEmail))) {
      fields['gift.recipientEmail'] = fieldCopy['gift.recipientEmail'];
    }
    if (text(gift.message).length > 280) fields['gift.message'] = fieldCopy['gift.message'];
  }

  const cardNumber = text(card.number).replace(/\s+/g, '');
  if (method === 'card') {
    if (!/^\d{16}$/.test(cardNumber)) fields['card.number'] = fieldCopy['card.number'];
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(text(card.expiry))) {
      fields['card.expiry'] = fieldCopy['card.expiry'];
    }
    if (!/^\d{3}$/.test(text(card.cvc))) fields['card.cvc'] = fieldCopy['card.cvc'];
  }

  const validNumber =
    typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= 240;
  if (!validNumber || Object.keys(fields).length > 0) throw failValidation(fields);

  return {
    number: number as number,
    method,
    buyer: { name: text(buyer.name), email: text(buyer.email) },
    address: {
      street: text(address.street),
      postcode: text(address.postcode),
      city: text(address.city),
    },
    gift:
      gift === null
        ? null
        : {
            recipientName: text(gift.recipientName),
            recipientEmail: text(gift.recipientEmail),
            message: text(gift.message),
          },
    ...(method === 'card'
      ? { card: { number: cardNumber, expiry: text(card.expiry), cvc: text(card.cvc) } }
      : {}),
  };
}

/** One hold has one order reference across attempts. */
async function openAttempt(body: CheckoutBody, holdToken: string): Promise<OrderRow> {
  const rateBasisPoints = await rateAt(businessNow());
  const split = saleSplit(rateBasisPoints);
  const existing = await loadOrderByHold(holdToken, body.number);
  if (existing !== null) {
    await query(
      `UPDATE orders SET method = $2, payment_state = 'started', buyer_name = $3, buyer_email = $4,
         street = $5, postcode = $6, city = $7, is_gift = $8, recipient_name = $9,
         recipient_email = $10, gift_message = $11, rate_basis_points = $12, net_ore = $13,
         vat_ore = $14, charity_ore = $15, maker_ore = $16, updated_at = now()
       WHERE reference = $1`,
      [
        existing.reference,
        body.method,
        body.buyer.name,
        body.buyer.email,
        body.address.street,
        body.address.postcode,
        body.address.city,
        body.gift !== null,
        body.gift?.recipientName ?? null,
        body.gift?.recipientEmail ?? null,
        body.gift?.message ?? null,
        rateBasisPoints,
        split.netOre,
        split.vatOre,
        split.charityOre,
        split.makerOre,
      ],
    );
    const refreshed = await loadOrder(existing.reference);
    if (refreshed === null) throw fail(404, 'not_found');
    return refreshed;
  }

  const rows = await query<OrderRow>(
    `INSERT INTO orders (reference, box_number, plate, method, payment_state, order_token, hold_token,
        buyer_name, buyer_email, street, postcode, city, is_gift, recipient_name, recipient_email,
        gift_message, rate_basis_points, gross_ore, courier_ore, total_ore, net_ore, vat_ore,
        charity_ore, maker_ore)
      VALUES ($1,$2,$3,$4,'started',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`,
    [
      newReference(),
      body.number,
      plateFor(body.number),
      body.method,
      newToken(),
      holdToken,
      body.buyer.name,
      body.buyer.email,
      body.address.street,
      body.address.postcode,
      body.address.city,
      body.gift !== null,
      body.gift?.recipientName ?? null,
      body.gift?.recipientEmail ?? null,
      body.gift?.message ?? null,
      rateBasisPoints,
      price.grossOre,
      price.courierOre,
      price.totalOre,
      split.netOre,
      split.vatOre,
      split.charityOre,
      split.makerOre,
    ],
  );
  const created = rows[0];
  if (created === undefined) throw fail(404, 'not_found');
  return created;
}

function heldReply(order: OrderRow, remainingMs: number | null): CheckoutReply {
  return {
    reference: order.reference,
    orderToken: order.order_token,
    paymentState: order.payment_state,
    boxState: 'held',
    holdRemainingMs: remainingMs,
  };
}

/** The clock that decides a transfer deadline, its lapse and a timely arrival. */
export function transferClockNow(): Date {
  return config.transferSeconds !== null ? realNow() : businessNow();
}

export function transferDeadline(): Date {
  if (config.transferSeconds !== null) {
    return new Date(realNow().getTime() + config.transferSeconds * 1000);
  }
  return thirdBankingDayDeadline(businessNow());
}

export interface CheckoutOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function runCheckout(
  body: CheckoutBody,
  holdToken: string,
  attemptKey: string,
): Promise<CheckoutOutcome> {
  const remainingMs = await holdRemainingMs(body.number, holdToken);
  if (remainingMs === null) throw failForBox(410, 'hold_ended', body.number);

  const order = await openAttempt(body, holdToken);
  await requireLedger('checkout');
  await ensureLedgerAccount(order);

  if (body.method === 'bank') return reserveForTransfer(order);
  return authoriseCard(order, body, attemptKey);
}

async function reserveForTransfer(order: OrderRow): Promise<CheckoutOutcome> {
  const reserved = await gateway.reserveTransfer(
    order.reference,
    order.total_ore,
    `${order.reference}-transfer`,
  );
  const deadline = transferDeadline();
  await inTransaction(async (client) => {
    await moveBox(client, order.box_number, 'held', 'awaiting_transfer');
    await updateOrder(client, order.reference, {
      payment_state: 'pending',
      transfer_id: reserved.transferId,
      transfer_deadline_at: deadline,
      live_claim: true,
      authorised_at: businessNow(),
    });
  });
  await consumeHold(order.box_number);
  announceBox(order.box_number, 'awaiting_transfer');
  await syncSearch([order.box_number]);
  await checkStockThresholds();
  await sendTransferInstructions(order, {
    iban: reserved.iban,
    paymentReference: reserved.paymentReference,
    amountOre: order.total_ore,
    deadlineAt: deadline,
  }).catch(() => undefined);
  return {
    status: 201,
    body: {
      reference: order.reference,
      orderToken: order.order_token,
      paymentState: 'pending',
      boxState: 'awaiting_transfer',
      holdRemainingMs: null,
      transfer: {
        iban: reserved.iban,
        paymentReference: reserved.paymentReference,
        amountOre: order.total_ore,
        deadlineAt: formatCopenhagenLocal(deadline),
      },
    },
  };
}

function declineOutcome(order: OrderRow, code: string, remainingMs: number | null): ApiError {
  const message = declineCopy[code as keyof typeof declineCopy] ?? declineCopy.do_not_honor;
  return new ApiError(402, code, message, undefined, {
    reference: order.reference,
    orderToken: order.order_token,
    paymentState: 'declined',
    boxState: 'held',
    holdRemainingMs: remainingMs,
  });
}

async function markDeclined(reference: string): Promise<void> {
  await query("UPDATE orders SET payment_state = 'declined', updated_at = now() WHERE reference = $1", [
    reference,
  ]);
}

async function authoriseCard(
  order: OrderRow,
  body: CheckoutBody,
  attemptKey: string,
): Promise<CheckoutOutcome> {
  const card = body.card;
  if (card === undefined) throw failValidation({ 'card.number': fieldCopy['card.number'] });
  const result = await gateway.authorise(order.reference, order.total_ore, card, attemptKey);

  if (result.kind === 'declined') {
    await markDeclined(order.reference);
    throw declineOutcome(
      order,
      result.declineCode,
      await holdRemainingMs(order.box_number, order.hold_token),
    );
  }

  if (result.kind === 'challenge') {
    const holdLeft = await holdRemainingMs(order.box_number, order.hold_token);
    if (holdLeft === null) throw failForBox(410, 'hold_ended', order.box_number);
    const challengeMs = Math.min(config.challengeSeconds * 1000, holdLeft);
    await query(
      `UPDATE orders SET payment_state = 'challenge', payment_id = $2, challenge_id = $3,
         challenge_expires_at = $4, updated_at = now() WHERE reference = $1`,
      [order.reference, result.paymentId, result.challengeId, new Date(realNow().getTime() + challengeMs)],
    );
    order.payment_state = 'challenge';
    return {
      status: 202,
      body: {
        ...heldReply(order, holdLeft),
        challenge: { id: result.challengeId, expiresInMs: challengeMs },
      },
    };
  }

  if (result.kind === 'pending') {
    await query(
      "UPDATE orders SET payment_state = 'started', payment_id = $2, updated_at = now() WHERE reference = $1",
      [order.reference, result.paymentId],
    );
    return {
      status: 202,
      body: { ...heldReply(order, await holdRemainingMs(order.box_number, order.hold_token)) },
    };
  }

  return finishAuthorisation(order, result.paymentId);
}

export async function finishAuthorisation(order: OrderRow, paymentId: string): Promise<CheckoutOutcome> {
  const holdLeft = await holdRemainingMs(order.box_number, order.hold_token);
  if (holdLeft === null) {
    await voidTooLate(order, paymentId);
    throw new ApiError(410, 'authorised_too_late', errorCopy.authorised_too_late, undefined, {
      reference: order.reference,
      orderToken: order.order_token,
      paymentState: 'voided',
      boxState: 'available',
      holdRemainingMs: null,
    });
  }
  await claimAuthorised(order, paymentId);
  await sendAuthorisationNotice(order).catch(() => undefined);
  return {
    status: 201,
    body: {
      reference: order.reference,
      orderToken: order.order_token,
      paymentState: 'authorised',
      boxState: 'claimed',
      holdRemainingMs: null,
    },
  };
}

export async function runChallenge(
  order: OrderRow,
  payload: { code?: string; cancel?: boolean },
): Promise<CheckoutOutcome> {
  if (
    order.challenge_id === null ||
    order.challenge_expires_at === null ||
    realNow().getTime() >= order.challenge_expires_at.getTime()
  ) {
    await markDeclined(order.reference);
    throw fail(410, 'challenge_expired');
  }
  const holdLeft = await holdRemainingMs(order.box_number, order.hold_token);
  if (holdLeft === null) throw failForBox(410, 'hold_ended', order.box_number);

  if (payload.cancel === true) {
    await markDeclined(order.reference);
    throw declineOutcome(order, 'challenge_cancelled', holdLeft);
  }

  const result = await gateway.answerChallenge(
    order.challenge_id,
    payload.code ?? '',
    `${order.reference}-challenge-${order.challenge_id}`,
  );
  if (result.kind === 'declined') {
    await markDeclined(order.reference);
    throw declineOutcome(order, result.declineCode, holdLeft);
  }
  if (order.payment_id === null) throw fail(410, 'challenge_expired');
  const outcome = await finishAuthorisation(order, order.payment_id);
  return { status: 200, body: outcome.body };
}
