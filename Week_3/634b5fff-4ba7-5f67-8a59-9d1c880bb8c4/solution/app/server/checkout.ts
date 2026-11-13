import { EDITION_PRICE, MAX_GIFT_MESSAGE } from "../shared/domain.js";
import { FIELD_ERRORS, type ErrorCode, type FieldName } from "../shared/copy.js";
import { moveBox } from "./boxes.js";
import { businessNow } from "./clock.js";
import { config } from "./config.js";
import { isUniqueViolation, pool, withLock, withTx } from "./db.js";
import { transferDeadline } from "./deadline.js";
import { answerChallenge, authorise, GatewayUnreachable, reserveTransfer, type CardDetails, type GatewayReply } from "./gateway.js";
import { ownedHold, remainingOrNull } from "./holds.js";
import { ApiError, errorBody, fail, statusOf } from "./http.js";
import { canRetryAttempt } from "./transitions.js";
import { begin, finish, fingerprint, forget, type Replay } from "./idempotency.js";
import { newReference, newToken } from "./ids.js";
import { enqueue } from "./jobs.js";
import { claimAuthorised } from "./payments.js";
import { ensureAccount, LedgerUnreachable } from "./killbill.js";
import { loadOrder, rateAt, requireOrder, setPaymentState, transferView, type OrderRow } from "./orders.js";
import { nudge } from "./shelf.js";
import { releaseHold } from "./valkey.js";

/** Checkout: one hold, one order reference, one gateway authorisation per attempt key. */

interface Details {
  number: number;
  method: "card" | "bank";
  buyer: { name: string; email: string };
  address: { street: string; postcode: string; city: string };
  gift: { recipientName: string; recipientEmail: string; message: string } | null;
  card: CardDetails | null;
}

type Raw = Record<string, unknown>;
const asRecord = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const asText = (value: unknown): string => (typeof value === "string" ? value : "");

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HEADER_UNSAFE = /[\r\n\0\u0085\u2028\u2029]/;

const validate = (raw: Raw): Details => {
  const errors: Partial<Record<FieldName, string>> = {};
  const flag = (field: FieldName, bad: boolean): void => {
    if (bad) errors[field] = FIELD_ERRORS[field];
  };
  const buyer = asRecord(raw.buyer);
  const address = asRecord(raw.address);
  const method = raw.method === "bank" ? "bank" : raw.method === "card" ? "card" : null;
  if (method === null || typeof raw.number !== "number") fail("validation_failed");
  const name = asText(buyer.name).trim();
  const email = asText(buyer.email).trim();
  flag("buyer.name", name === "" || HEADER_UNSAFE.test(name));
  flag("buyer.email", !EMAIL.test(email) || HEADER_UNSAFE.test(email));
  flag("address.street", asText(address.street).trim() === "");
  flag("address.postcode", !/^\d{4}$/.test(asText(address.postcode).trim()));
  flag("address.city", asText(address.city).trim() === "");
  const giftRaw = raw.gift === null || raw.gift === undefined ? null : asRecord(raw.gift);
  if (giftRaw) {
    flag("gift.recipientName", asText(giftRaw.recipientName).trim() === "" || HEADER_UNSAFE.test(asText(giftRaw.recipientName)));
    flag("gift.recipientEmail", !EMAIL.test(asText(giftRaw.recipientEmail).trim()));
    flag("gift.message", asText(giftRaw.message).length > MAX_GIFT_MESSAGE);
  }
  const cardRaw = asRecord(raw.card);
  const cardNumber = asText(cardRaw.number).replace(/\s+/g, "");
  if (method === "card") {
    flag("card.number", !/^\d{16}$/.test(cardNumber));
    flag("card.expiry", !/^(0[1-9]|1[0-2])\/\d{2}$/.test(asText(cardRaw.expiry)));
    flag("card.cvc", !/^\d{3}$/.test(asText(cardRaw.cvc)));
  }
  if (Object.keys(errors).length > 0) fail("validation_failed", { fields: errors });
  return {
    number: raw.number as number,
    method,
    buyer: { name, email },
    address: { street: asText(address.street).trim(), postcode: asText(address.postcode).trim(), city: asText(address.city).trim() },
    gift: giftRaw
      ? { recipientName: asText(giftRaw.recipientName).trim(), recipientEmail: asText(giftRaw.recipientEmail).trim(), message: asText(giftRaw.message) }
      : null,
    card: method === "card" ? { number: cardNumber, expiry: asText(cardRaw.expiry), cvc: asText(cardRaw.cvc) } : null,
  };
};

const view = async (order: OrderRow, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => ({
  reference: order.reference,
  orderToken: order.order_token,
  paymentState: order.payment_state,
  boxState: order.box_state ?? "held",
  holdRemainingMs: order.box_state ? null : await remainingOrNull(order.box_number),
  ...extra,
});

const declined = async (order: OrderRow, code: ErrorCode): Promise<Replay> => ({
  status: statusOf(code),
  body: errorBody(code, { extra: await view(order) }),
});

const DECLINES = new Set<string>(["do_not_honor", "insufficient_funds", "expired_card", "challenge_failed"]);

const declineCodeOf = (reply: GatewayReply): ErrorCode =>
  DECLINES.has(String(reply.body.declineCode)) ? (reply.body.declineCode as ErrorCode) : "do_not_honor";

const findOrder = async (number: number, token: string): Promise<OrderRow | null> =>
  ((await pool.query("SELECT * FROM orders WHERE box_number = $1 AND hold_token = $2", [number, token])).rows[0] as OrderRow | undefined) ?? null;

/** Records the buyer's details on the hold's one order, creating it on the first attempt. */
const recordAttempt = async (details: Details, token: string, accountId: string): Promise<OrderRow> => {
  await pool.query(
    "INSERT INTO orders (reference, box_number, hold_token, order_token) VALUES ($1, $2, $3, $4) ON CONFLICT (box_number, hold_token) DO NOTHING",
    [newReference(), details.number, token, newToken()],
  );
  await pool.query(
    `UPDATE orders SET method = $3, buyer_name = $4, buyer_email = $5, street = $6, postcode = $7, city = $8,
       gift_name = $9, gift_email = $10, gift_message = $11, kb_account_id = $12 WHERE box_number = $1 AND hold_token = $2`,
    [details.number, token, details.method, details.buyer.name, details.buyer.email, details.address.street, details.address.postcode,
      details.address.city, details.gift?.recipientName ?? null, details.gift?.recipientEmail ?? null, details.gift?.message ?? null, accountId],
  );
  return (await findOrder(details.number, token)) as OrderRow;
};

/** A new attempt starts from a declined or abandoned one, or from a fresh order; anything further along keeps its result. */
const canStartAttempt = (order: OrderRow | null): boolean =>
  !order || canRetryAttempt(order.payment_state) || (order.payment_state === "started" && !order.payment_id);

const beginAttempt = async (order: OrderRow): Promise<void> => {
  if (order.payment_state === "challenge") await setPaymentState(pool, order, "declined");
  if (order.payment_state === "declined") await setPaymentState(pool, order, "started");
};

const challengeWindowMs = async (order: OrderRow): Promise<number> =>
  Math.min(config.challengeSeconds * 1000, (await remainingOrNull(order.box_number)) ?? 0);

const afterAuthorised = async (order: OrderRow): Promise<Replay> => {
  const claim = await claimAuthorised(order.reference);
  const fresh = await requireOrder(pool, order.reference);
  if (claim === "too_late") return { status: statusOf("authorised_too_late"), body: errorBody("authorised_too_late", { extra: await view(fresh) }) };
  return { status: 201, body: await view(fresh) };
};

const payByCard = async (order: OrderRow, card: CardDetails, key: string): Promise<Replay> => {
  const reply = await authorise(order.reference, EDITION_PRICE.totalOre, card, key);
  const paymentId = String(reply.body.paymentId ?? "");
  if (reply.status === 402 || reply.body.status === "declined") {
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, order.reference), declineCodeOf(reply));
  }
  await pool.query("UPDATE orders SET payment_id = $2 WHERE reference = $1", [order.reference, paymentId]);
  if (reply.body.status === "challenge") {
    const window = await challengeWindowMs(order);
    await pool.query("UPDATE orders SET challenge_id = $2, challenge_expires_at = $3 WHERE reference = $1", [
      order.reference, String(reply.body.challengeId), new Date(Date.now() + window),
    ]);
    await setPaymentState(pool, order, "challenge");
    return { status: 202, body: await view(await requireOrder(pool, order.reference), { challenge: { id: String(reply.body.challengeId), expiresInMs: window } }) };
  }
  if (reply.body.confirmation === "callback") return { status: 202, body: await view(await requireOrder(pool, order.reference)) };
  return afterAuthorised(order);
};

const payByTransfer = async (order: OrderRow, key: string): Promise<Replay> => {
  const reply = await reserveTransfer(order.reference, EDITION_PRICE.totalOre, key);
  const now = businessNow();
  try {
    await withTx(async (tx) => {
      const locked = await requireOrder(tx, order.reference, true);
      await moveBox(tx, locked.box_number, "awaiting_transfer", order.reference);
      await setPaymentState(tx, locked, "pending");
      await tx.query(
        `UPDATE orders SET transfer_id = $2, transfer_iban = $3, transfer_reference = $4, rate_basis_points = $5, authorised_at = $6, deadline_at = $7
         WHERE reference = $1`,
        [order.reference, String(reply.body.transferId), String(reply.body.iban), String(reply.body.paymentReference), await rateAt(tx, now), now, transferDeadline(now)],
      );
      await enqueue(tx, "mail", `transfer-${order.reference}`, { template: "transfer", reference: order.reference });
    });
  } catch (error) {
    if ((error instanceof ApiError && error.code === "illegal_transition") || isUniqueViolation(error)) return fail("box_taken", { number: order.box_number });
    throw error;
  }
  await releaseHold(order.box_number, order.hold_token).catch(() => false);
  nudge();
  const fresh = await requireOrder(pool, order.reference);
  return { status: 201, body: await view(fresh, { transfer: transferView(fresh) }) };
};

const attempt = async (details: Details, token: string, key: string): Promise<Replay> => {
  let accountId: string;
  try {
    accountId = await ensureAccount(details.buyer.email, details.buyer.name);
  } catch (error) {
    if (error instanceof LedgerUnreachable) return fail("ledger_unreachable");
    throw error;
  }
  const existing = await findOrder(details.number, token);
  if (existing && !canStartAttempt(existing)) {
    return { status: existing.payment_state === "started" ? 202 : 201, body: await view(existing, { transfer: transferView(existing) }) };
  }
  const order = await recordAttempt(details, token, accountId);
  await beginAttempt(order);
  try {
    return details.card ? await payByCard(order, details.card, key) : await payByTransfer(order, key);
  } catch (error) {
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable");
    throw error;
  }
};

/** The request body as the idempotency store may keep it: the card reduced to its last four digits and expiry. */
const withoutCardSecrets = (body: Raw): Raw => {
  const card = asRecord(body.card);
  return { ...body, card: body.card === undefined ? undefined : { last4: asText(card.number).replace(/\s+/g, "").slice(-4), expiry: card.expiry } };
};

export const checkout = async (token: string | undefined, key: string | undefined, rawBody: unknown): Promise<Replay> => {
  const body = asRecord(rawBody);
  const scope = key ? { key, print: fingerprint("POST", "/api/checkout", withoutCardSecrets(body)) } : null;
  if (scope) {
    const replay = await begin("checkout", scope.key, scope.print);
    if (replay) return replay;
  }
  try {
    if (typeof body.number !== "number") return fail("validation_failed");
    await ownedHold(body.number, token);
    if (!scope) return fail("validation_failed");
    const details = validate(body);
    const result = await withLock(details.number, () => attempt(details, token ?? "", scope.key));
    await finish("checkout", scope.key, result.status, result.body);
    return result;
  } catch (error) {
    if (scope) await forget("checkout", scope.key);
    throw error;
  }
};

interface ChallengeInput {
  code?: unknown;
  cancel?: unknown;
}

export const answer = async (reference: string, token: string | undefined, input: ChallengeInput): Promise<Replay> => {
  const order = await loadOrder(pool, reference);
  if (!order) return fail("not_found");
  if (order.hold_token !== token) return fail("hold_not_yours");
  await ownedHold(order.box_number, token);
  if (order.payment_state !== "challenge" || !order.challenge_id) return fail("illegal_transition");
  const hasCode = typeof input.code === "string" && input.code !== "";
  if (input.cancel !== true && !hasCode) return fail("validation_failed");
  if (input.cancel === true) {
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, reference), "challenge_cancelled");
  }
  if (order.challenge_expires_at && order.challenge_expires_at.getTime() <= Date.now()) {
    await setPaymentState(pool, order, "declined");
    return fail("challenge_expired");
  }
  try {
    const reply = await answerChallenge(order.challenge_id, input.code as string, `challenge-${reference}-${newToken()}`);
    if (reply.status === 200 && reply.body.status === "authorised") return await afterAuthorised(order);
    await setPaymentState(pool, order, "declined");
    return declined(await requireOrder(pool, reference), "challenge_failed");
  } catch (error) {
    if (error instanceof GatewayUnreachable) return fail("gateway_unreachable");
    throw error;
  }
};

