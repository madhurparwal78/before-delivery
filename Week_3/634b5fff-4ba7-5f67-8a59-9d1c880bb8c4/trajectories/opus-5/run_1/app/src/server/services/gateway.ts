import { config } from '../config.js';

/** Thrown when the gateway's line is down: connection failure, timeout or 5xx. */
export class GatewayUnreachable extends Error {}

export type Confirmation = 'immediate' | 'callback';

interface GatewayReply {
  status: number;
  body: Record<string, unknown>;
}

async function call(path: string, body: unknown, idempotencyKey: string): Promise<GatewayReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status >= 500) throw new GatewayUnreachable(`gateway ${response.status}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof GatewayUnreachable) throw error;
    throw new GatewayUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export type AuthorisationResult =
  | { kind: 'authorised'; paymentId: string; confirmation: Confirmation }
  | { kind: 'challenge'; paymentId: string; challengeId: string }
  | { kind: 'pending'; paymentId: string }
  | { kind: 'declined'; declineCode: string };

export async function authorise(
  reference: string,
  amountOre: number,
  card: { number: string; expiry: string; cvc: string },
  idempotencyKey: string,
): Promise<AuthorisationResult> {
  const reply = await call(
    '/v1/authorisations',
    { reference, amountOre, currency: 'DKK', card },
    idempotencyKey,
  );
  const status = String(reply.body.status);
  if (status === 'authorised') {
    return {
      kind: 'authorised',
      paymentId: String(reply.body.paymentId),
      confirmation: reply.body.confirmation === 'callback' ? 'callback' : 'immediate',
    };
  }
  if (status === 'challenge') {
    return {
      kind: 'challenge',
      paymentId: String(reply.body.paymentId),
      challengeId: String(reply.body.challengeId),
    };
  }
  if (status === 'pending') {
    return { kind: 'pending', paymentId: String(reply.body.paymentId) };
  }
  return { kind: 'declined', declineCode: String(reply.body.declineCode) };
}

export type ChallengeResult =
  | { kind: 'authorised'; confirmation: Confirmation }
  | { kind: 'declined'; declineCode: string };

export async function answerChallenge(
  challengeId: string,
  code: string,
  idempotencyKey: string,
): Promise<ChallengeResult> {
  const reply = await call(`/v1/challenges/${challengeId}`, { code }, idempotencyKey);
  if (String(reply.body.status) === 'authorised') {
    return { kind: 'authorised', confirmation: reply.body.confirmation === 'callback' ? 'callback' : 'immediate' };
  }
  return { kind: 'declined', declineCode: String(reply.body.declineCode) };
}

export type CaptureResult =
  | { kind: 'captured'; confirmation: Confirmation }
  | { kind: 'pending' }
  | { kind: 'capture_failed' };

export async function capture(
  paymentId: string,
  amountOre: number,
  idempotencyKey: string,
): Promise<CaptureResult> {
  const reply = await call(`/v1/payments/${paymentId}/capture`, { amountOre }, idempotencyKey);
  const status = String(reply.body.status);
  if (status === 'captured') {
    return { kind: 'captured', confirmation: reply.body.confirmation === 'callback' ? 'callback' : 'immediate' };
  }
  if (status === 'pending') return { kind: 'pending' };
  return { kind: 'capture_failed' };
}

export async function voidPayment(paymentId: string, idempotencyKey: string): Promise<void> {
  await call(`/v1/payments/${paymentId}/void`, {}, idempotencyKey);
}

export interface GatewayRefund {
  refundId: string;
  confirmation: Confirmation;
}

export async function refundPayment(
  paymentId: string,
  amountOre: number,
  idempotencyKey: string,
): Promise<GatewayRefund> {
  const reply = await call(`/v1/payments/${paymentId}/refunds`, { amountOre }, idempotencyKey);
  return {
    refundId: String(reply.body.refundId),
    confirmation: reply.body.confirmation === 'callback' ? 'callback' : 'immediate',
  };
}

export interface ReservedTransfer {
  transferId: string;
  iban: string;
  paymentReference: string;
}

export async function reserveTransfer(
  reference: string,
  amountOre: number,
  idempotencyKey: string,
): Promise<ReservedTransfer> {
  const reply = await call('/v1/transfers', { reference, amountOre, currency: 'DKK' }, idempotencyKey);
  return {
    transferId: String(reply.body.transferId),
    iban: String(reply.body.iban),
    paymentReference: String(reply.body.paymentReference),
  };
}

export async function refundTransfer(
  transferId: string,
  amountOre: number,
  idempotencyKey: string,
): Promise<void> {
  await call(`/v1/transfers/${transferId}/refund`, { amountOre }, idempotencyKey);
}

export async function returnTransfer(
  transferId: string,
  amountOre: number,
  idempotencyKey: string,
): Promise<void> {
  await call(`/v1/transfers/${transferId}/return`, { amountOre }, idempotencyKey);
}

export interface CourierBooking {
  bookingId: string;
  trackingCode: string;
}

export async function bookCourier(
  reference: string,
  boxNumber: number,
  recipientName: string,
  address: { street: string; postcode: string; city: string },
  idempotencyKey: string,
): Promise<CourierBooking> {
  const reply = await call(
    '/v1/courier/bookings',
    { reference, boxNumber, recipientName, address },
    idempotencyKey,
  );
  return { bookingId: String(reply.body.bookingId), trackingCode: String(reply.body.trackingCode) };
}
