import { config } from './config.js';

export type AuthorisationResult =
  | { kind: 'authorised'; paymentId: string; confirmation: 'immediate' | 'callback' }
  | { kind: 'challenge'; paymentId: string; challengeId: string }
  | { kind: 'pending'; paymentId: string; confirmation: 'callback' }
  | { kind: 'declined'; declineCode: string };

export class GatewayDown extends Error {}

async function call(path: string, method: string, body: unknown, idempotencyKey: string): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.wiremockUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (res.status >= 500) throw new GatewayDown(`gateway ${res.status}`);
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof GatewayDown) throw err;
    throw new GatewayDown(String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function authorise(payment: {
  reference: string; amountOre: number; card: { number: string; expiry: string; cvc: string };
}, key: string): Promise<AuthorisationResult> {
  const { status, body } = await call('/v1/authorisations', 'POST', {
    reference: payment.reference,
    amountOre: payment.amountOre,
    currency: 'DKK',
    card: payment.card,
  }, key);
  if (status === 201 && body.status === 'authorised') return { kind: 'authorised', paymentId: body.paymentId, confirmation: body.confirmation };
  if (status === 202 && body.status === 'challenge') return { kind: 'challenge', paymentId: body.paymentId, challengeId: body.challengeId };
  if (status === 202 && body.status === 'pending') return { kind: 'pending', paymentId: body.paymentId, confirmation: 'callback' };
  if (status === 402) return { kind: 'declined', declineCode: body.declineCode };
  throw new GatewayDown(`unexpected authorisation reply ${status}`);
}

export async function answerChallenge(challengeId: string, code: string, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/challenges/${challengeId}`, 'POST', { code }, key);
}

export async function capture(paymentId: string, amountOre: number, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/payments/${paymentId}/capture`, 'POST', { amountOre }, key);
}

export async function voidPayment(paymentId: string, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/payments/${paymentId}/void`, 'POST', {}, key);
}

export async function refundPayment(paymentId: string, amountOre: number, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/payments/${paymentId}/refunds`, 'POST', { amountOre }, key);
}

export async function createTransfer(reference: string, amountOre: number, key: string): Promise<{ transferId: string; iban: string; paymentReference: string }> {
  const { status, body } = await call('/v1/transfers', 'POST', { reference, amountOre, currency: 'DKK' }, key);
  if (status !== 201) throw new GatewayDown(`transfer failed ${status}`);
  return body;
}

export async function refundTransfer(transferId: string, amountOre: number, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/transfers/${transferId}/refund`, 'POST', { amountOre }, key);
}

export async function returnTransfer(transferId: string, amountOre: number, key: string): Promise<{ status: number; body: any }> {
  return call(`/v1/transfers/${transferId}/return`, 'POST', { amountOre }, key);
}

export async function bookCourier(booking: { reference: string; boxNumber: number; recipientName: string; address: { street: string; postcode: string; city: string } }, key: string): Promise<{ bookingId: string; trackingCode: string }> {
  const { status, body } = await call('/v1/courier/bookings', 'POST', booking, key);
  if (status !== 201) throw new Error(`courier booking failed ${status}`);
  return body;
}
