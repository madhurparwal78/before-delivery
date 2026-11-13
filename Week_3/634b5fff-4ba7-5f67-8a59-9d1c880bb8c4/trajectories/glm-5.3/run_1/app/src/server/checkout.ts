import { query, withTransaction } from './db.js';
import { config, businessClock } from './config.js';
import { bankingDeadline } from './pure.js';
import { apiError, validationError } from './errors.js';
import * as redis from './holds.js';
import * as gw from './gateway.js';
import * as kb from './killbill.js';
import { copy } from '../shared/copy.js';
import {
  OrderRow, insertOrder, isUniqueViolation, newReference, newToken,
  rateAtInstant, moveBox,
} from './orders.js';
import { BOX_GROSS_ORE, BOX_NET_ORE, COURIER_ORE, ORDER_TOTAL_ORE, splitBox, plateFor } from './edition.js';
import { publishBox } from './shelfHub.js';
import { reindexBox } from './indexer.js';
import * as mail from './mail.js';
import { formatOre, divideRound } from '../shared/money.js';
import { stockAfterChange } from './stock.js';

export interface CheckoutBody {
  number: number;
  method: 'card' | 'bank';
  buyer: { name: string; email: string };
  address: { street: string; postcode: string; city: string };
  gift?: { recipientName: string; recipientEmail: string; message: string } | null;
  card?: { number: string; expiry: string; cvc: string };
}

export interface CheckoutReply {
  reference: string;
  orderToken: string;
  paymentState: string;
  boxState: string;
  holdRemainingMs: number | null;
  challenge?: { id: string; expiresInMs: number };
  transfer?: { iban: string; paymentReference: string; amountOre: number; deadlineAt: string };
  bodyHash?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validation in one place. */
export function validateCheckout(body: CheckoutBody): Record<string, string> {
  const f: Record<string, string> = {};
  if (!body.buyer?.name?.trim()) f['buyer.name'] = copy.fields['buyer.name'];
  if (!body.buyer?.email || !EMAIL_RE.test(body.buyer.email)) f['buyer.email'] = copy.fields['buyer.email'];
  if (!body.address?.street?.trim()) f['address.street'] = copy.fields['address.street'];
  if (!/^\d{4}$/.test(body.address?.postcode ?? '')) f['address.postcode'] = copy.fields['address.postcode'];
  if (!body.address?.city?.trim()) f['address.city'] = copy.fields['address.city'];
  if (body.gift) {
    if (!body.gift.recipientName?.trim()) f['gift.recipientName'] = copy.fields['gift.recipientName'];
    if (!body.gift.recipientEmail || !EMAIL_RE.test(body.gift.recipientEmail)) f['gift.recipientEmail'] = copy.fields['gift.recipientEmail'];
    if ((body.gift.message ?? '').length > 280) f['gift.message'] = copy.fields['gift.message'];
  }
  if (body.method === 'card') {
    const n = (body.card?.number ?? '').replace(/\s+/g, '');
    if (!/^\d{16}$/.test(n)) f['card.number'] = copy.fields['card.number'];
    if (!/^\d{2}\/\d{2}$/.test(body.card?.expiry ?? '')) f['card.expiry'] = copy.fields['card.expiry'];
    if (!/^\d{3}$/.test(body.card?.cvc ?? '')) f['card.cvc'] = copy.fields['card.cvc'];
  }
  return f;
}

/** The banking-day deadline: 23:59:59 Copenhagen on the third banking day. */
export function transferDeadline(from: Date): Date {
  if (config.transferSeconds !== undefined) {
    return new Date(from.getTime() + config.transferSeconds * 1000);
  }
  return bankingDeadline(from);
}

export async function doCheckout(body: CheckoutBody, holdToken: string, idempotencyKey: string, bodyHash: string): Promise<{ status: number; reply: CheckoutReply }> {
  // Idempotent replay: return the first result. The same key with a
  // different body is a conflict.
  const stored = await query<{ kind: string; reference: string; status: number; body: string }>(
    'SELECT kind, reference, status, body FROM idempotency_keys WHERE key = $1',
    [idempotencyKey],
  );
  if (stored.length > 0) {
    if (stored[0].kind !== 'checkout') throw apiError(409, 'idempotency_conflict');
    const saved = JSON.parse(stored[0].body) as { body: CheckoutReply & { bodyHash?: string } };
    if (saved.body?.bodyHash && saved.body.bodyHash !== bodyHash) {
      throw apiError(409, 'idempotency_conflict');
    }
    const reply = { ...saved.body };
    delete reply.bodyHash;
    return { status: stored[0].status, reply };
  }

  const fields = validateCheckout(body);
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const number = body.number;
  const boxRows = await query<{ number: number; plate: string; box_state: string }>(
    'SELECT number, plate, box_state FROM boxes WHERE number = $1', [number],
  );
  if (boxRows.length === 0) throw apiError(404, 'not_found');

  // The hold must exist and belong to this token.
  const token = await redis.holdToken(number);
  if (token === null) {
    // Maybe an order already exists: distinguish box_taken from hold_ended.
    const order = await query<{ reference: string; box_state: string }>(
      "SELECT reference, box_state FROM orders WHERE number = $1 AND box_state IN ('claimed','awaiting_transfer','packed','shipped','returned') LIMIT 1",
      [number],
    );
    if (order.length > 0) throw apiError(409, 'box_taken');
    throw apiError(410, 'hold_ended');
  }
  if (token !== holdToken) throw apiError(403, 'hold_not_yours');

  // Sales paused when Valkey is down: hold endpoints answer 503 sales_paused
  // (checked in the route layer).
  const editionClosed = businessClock.nowMs() >= Date.parse('2027-02-01T00:00:00+01:00');
  if (editionClosed) throw apiError(409, 'edition_closed');

  const reference = newReference();
  const orderToken = newToken();
  const plate = plateFor(number);
  const now = businessClock.now();
  const rateBps = await rateAtInstant(now);
  const split = splitBox(BOX_NET_ORE, rateBps);

  const holdRemainingMs = await redis.holdRemainingMs(number) ?? 0;

  if (body.method === 'bank') {
    return checkoutBank(body, number, plate, reference, orderToken, rateBps, split, now, idempotencyKey, bodyHash);
  }
  return checkoutCard(body, number, plate, reference, orderToken, rateBps, split, holdRemainingMs, idempotencyKey, bodyHash);
}

async function checkoutBank(
  body: CheckoutBody, number: number, plate: string, reference: string, orderToken: string,
  rateBps: number, split: { charityOre: number; makerOre: number }, now: Date,
  idempotencyKey: string, bodyHash: string,
): Promise<{ status: number; reply: CheckoutReply }> {
  // Claim the box first, under the database constraint.
  try {
    await withTransaction(async (client) => {
      // Confirm the hold still exists before converting it.
      if (!(await redis.holdExists(number))) throw apiError(410, 'hold_ended');
      await moveBox(client, number, "held", "awaiting_transfer", reference);
      await insertOrder(client, {
        ...baseOrder(number, plate, reference, orderToken, rateBps, split),
        method: 'bank',
        payment_state: 'pending',
        box_state: 'awaiting_transfer',
        gift_recipient_name: body.gift?.recipientName ?? null,
        gift_recipient_email: body.gift?.recipientEmail ?? null,
        gift_message: body.gift?.message ?? null,
        buyer_name: body.buyer.name,
        buyer_email: body.buyer.email,
        address_street: body.address.street,
        address_postcode: body.address.postcode,
        address_city: body.address.city,
        authorised_at: now,
        hold_token: null,
        hold_expires_at: null,
      } as OrderRow);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw apiError(409, 'box_taken');
    }
    throw err;
  }

  // Register with the gateway for the transfer details.
  let transfer: { transferId: string; iban: string; paymentReference: string };
  try {
    transfer = await gw.createTransfer(reference, ORDER_TOTAL_ORE, `transfer-${reference}`);
  } catch (err) {
    // Gateway down: release the box and answer the outage.
    await withTransaction(async (client) => {
      await moveBox(client, number, "awaiting_transfer", "available", reference);
      await client.query('DELETE FROM orders WHERE reference = $1', [reference]);
    });
    await publishBox(number, 'available');
    throw apiError(503, 'gateway_unreachable');
  }

  const deadline = transferDeadline(now);
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE orders SET gateway_transfer_id = $1, transfer_iban = $2, transfer_reference = $3, transfer_deadline_at = $4 WHERE reference = $5',
      [transfer.transferId, transfer.iban, transfer.paymentReference, deadline.toISOString(), reference],
    );
  });

  // Mail the instructions.
  const text = [
    `Bank transfer instructions for box ${number} (${reference})`,
    '',
    `IBAN: ${transfer.iban}`,
    `Payment reference: ${transfer.paymentReference}`,
    `Amount: DKK ${formatOre(ORDER_TOTAL_ORE)}`,
    `Deadline: ${deadline.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })}`,
  ].join('\n');
  try {
    await mail.sendMail(body.buyer.email, `Bank transfer instructions for box ${number} (${reference})`, text);
  } catch { /* retried under its event */ }

  publishBox(number, 'taken');
  void stockAfterChange('held', 'awaiting_transfer', number);
  void reindexBox(number, plate, 'awaiting_transfer').catch(() => {});

  const reply: CheckoutReply = {
    reference,
    orderToken,
    paymentState: 'pending',
    boxState: 'awaiting_transfer',
    holdRemainingMs: null,
    transfer: {
      iban: transfer.iban,
      paymentReference: transfer.paymentReference,
      amountOre: ORDER_TOTAL_ORE,
      deadlineAt: copenhagenIso(deadline),
    },
  };
  await storeIdempotent(idempotencyKey, 'checkout', reference, 201, { ...reply, bodyHash });
  return { status: 201, reply };
}

async function checkoutCard(
  body: CheckoutBody, number: number, plate: string, reference: string, orderToken: string,
  rateBps: number, split: { charityOre: number; makerOre: number },
  holdRemainingMs: number, idempotencyKey: string, bodyHash: string,
): Promise<{ status: number; reply: CheckoutReply }> {
  const card = {
    number: body.card!.number.replace(/\s+/g, ''),
    expiry: body.card!.expiry,
    cvc: body.card!.cvc,
  };

  let auth: gw.AuthorisationResult;
  try {
    auth = await gw.authorise({ reference, amountOre: ORDER_TOTAL_ORE, card }, idempotencyKey);
  } catch {
    throw apiError(503, 'gateway_unreachable');
  }

  if (auth.kind === 'declined') {
    // Record the decline as a replayable result; the hold is untouched.
    const reply: CheckoutReply = {
      reference,
      orderToken,
      paymentState: 'declined',
      boxState: 'held',
      holdRemainingMs,
    };
    await storeIdempotent(idempotencyKey, 'checkout', reference, 402, { ...reply, bodyHash });
    const err = apiError(402, auth.declineCode, {
      reference, orderToken, paymentState: 'declined', boxState: 'held', holdRemainingMs,
    });
    throw err;
  }

  // Kill Bill invoice and authorisation record.
  let kbAccountId = '';
  let kbInvoiceId = '';
  let kbPaymentId = '';
  try {
    kbAccountId = await kb.ensureAccount(body.buyer.email, body.buyer.name);
    await kb.ensurePaymentMethod(kbAccountId);
    kbInvoiceId = await kb.createCommittedInvoice(kbAccountId, [
      { description: 'maker share', amount: split.makerOre / 100 },
      { description: 'charity share', amount: split.charityOre / 100 },
      { description: 'VAT', amount: divideRound(BOX_GROSS_ORE - BOX_NET_ORE, 1) / 100 },
      { description: 'courier', amount: COURIER_ORE / 100 },
    ]);
    kbPaymentId = await kb.authoriseTransaction(kbAccountId, ORDER_TOTAL_ORE / 100, reference, `auth-${idempotencyKey}`);
  } catch (err) {
    console.error('ledger at checkout:', err instanceof Error ? err.message : err);
    // Kill Bill down before the gateway confirmed: authorisation stands, the
    // capture waits, and the gateway result is retried.
    throw apiError(503, 'ledger_unreachable');
  }

  // Claim the box in the database.
  try {
    await withTransaction(async (client) => {
      if (!(await redis.holdExists(number))) throw apiError(410, 'authorised_too_late');
      await moveBox(client, number, "held", "claimed", reference);
      await insertOrder(client, {
        ...baseOrder(number, plate, reference, orderToken, rateBps, split),
        method: 'card',
        payment_state: 'authorised',
        box_state: 'claimed',
        gift_recipient_name: body.gift?.recipientName ?? null,
        gift_recipient_email: body.gift?.recipientEmail ?? null,
        gift_message: body.gift?.message ?? null,
        buyer_name: body.buyer.name,
        buyer_email: body.buyer.email,
        address_street: body.address.street,
        address_postcode: body.address.postcode,
        address_city: body.address.city,
        authorised_at: businessClock.now(),
        gateway_payment_id: (auth as { paymentId: string }).paymentId,
        kb_account_id: kbAccountId,
        kb_invoice_id: kbInvoiceId,
        kb_payment_id: kbPaymentId,
        auth_expires_at: new Date(Date.now() + config.authSeconds * 1000),
        hold_token: null,
        hold_expires_at: null,
      } as OrderRow);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw apiError(409, 'box_taken');
    if (err instanceof Error && (err as { code?: string }).code === 'authorised_too_late') {
      // Void the authorisation automatically.
      await gw.voidPayment((auth as { paymentId: string }).paymentId, `void-${reference}`).catch(() => {});
      await kb.voidTransaction(kbPaymentId, `void-${reference}`).catch(() => {});
      throw apiError(410, 'authorised_too_late');
    }
    throw err;
  }

  publishBox(number, 'taken');
  void stockAfterChange('held', 'claimed', number);
  void reindexBox(number, plate, 'claimed').catch(() => {});

  if (auth.kind === 'challenge') {
    const challengeExpiry = Math.min(
      config.challengeSeconds * 1000,
      holdRemainingMs ?? config.challengeSeconds * 1000,
    );
    const expiresAt = new Date(Date.now() + challengeExpiry);
    await query(
      'INSERT INTO challenge_attempts (challenge_id, reference, attempt_key, payment_id, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (challenge_id) DO NOTHING',
      [auth.challengeId, reference, idempotencyKey, auth.paymentId, expiresAt.toISOString()],
    );
    const reply: CheckoutReply = {
      reference,
      orderToken,
      paymentState: 'challenge',
      boxState: 'claimed',
      holdRemainingMs,
      challenge: { id: auth.challengeId, expiresInMs: challengeExpiry },
    };
    await storeIdempotent(idempotencyKey, 'checkout', reference, 202, { ...reply, bodyHash });
    return { status: 202, reply };
  }

  if (auth.kind === 'pending') {
    // Waiting for the signed callback.
    const reply: CheckoutReply = {
      reference,
      orderToken,
      paymentState: 'started',
      boxState: 'claimed',
      holdRemainingMs,
    };
    await storeIdempotent(idempotencyKey, 'checkout', reference, 202, { ...reply, bodyHash });
    return { status: 202, reply };
  }

  // authorised immediately
  await sendAuthorisationNotice(number, reference, body.buyer.email);
  const reply: CheckoutReply = {
    reference,
    orderToken,
    paymentState: 'authorised',
    boxState: 'claimed',
    holdRemainingMs,
  };
  await storeIdempotent(idempotencyKey, 'checkout', reference, 201, { ...reply, bodyHash });
  return { status: 201, reply };
}

function baseOrder(number: number, plate: string, reference: string, orderToken: string, rateBps: number, split: { charityOre: number; makerOre: number }): Partial<OrderRow> {
  return {
    reference,
    order_token: orderToken,
    number,
    plate,
    rate_bps: rateBps,
    total_ore: ORDER_TOTAL_ORE,
    gross_ore: BOX_GROSS_ORE,
    net_ore: BOX_NET_ORE,
    vat_ore: BOX_GROSS_ORE - BOX_NET_ORE,
    charity_ore: split.charityOre,
    maker_ore: split.makerOre,
    courier_ore: COURIER_ORE,
    gateway_fee_ore: null,
    paid_at: null,
    certificate_state: 'none',
    certificate_key: null,
    tracking_code: null,
  };
}

export async function sendAuthorisationNotice(number: number, reference: string, email: string): Promise<void> {
  const text = `Your card is authorised for box ${number} (${reference}). You have not been charged yet.`;
  await mail.sendMail(email, `Box ${number} is reserved: card authorised (${reference})`, text);
}

export async function storeIdempotent(key: string, kind: string, reference: string, status: number, body: unknown): Promise<void> {
  await query(
    `INSERT INTO idempotency_keys (key, kind, reference, status, body) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO NOTHING`,
    [key, kind, reference, status, JSON.stringify({ body })],
  );
}

/** Copenhagen local time with offset, e.g. 2026-12-29T23:59:59+01:00. */
export function copenhagenIso(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const stamp = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  return `${stamp}${offsetString(d)}`;
}

function offsetString(d: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', timeZoneName: 'shortOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(name);
  if (!m) return '+01:00';
  const sign = m[1];
  const hh = m[2].padStart(2, '0');
  const mm = (m[3] ?? '0').padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}
