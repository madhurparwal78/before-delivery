import { loadConfig } from './config.js';

export interface PaymentRecord {
  id: string;
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  amount_cents: number;
  currency: string;
  reference: string;
  confirmed_at?: string;
}

export class ProviderError extends Error {
  constructor(message = "The payment provider can't be reached.") {
    super(message);
  }
}

const TIMEOUT_MS = 5_000;

async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const base = loadConfig().wiremockUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (res.status >= 500) throw new ProviderError();
    if (!res.ok) throw new ProviderError(`The payment provider answered ${res.status}.`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError();
  } finally {
    clearTimeout(timer);
  }
}

export function createPayment(input: {
  idempotencyKey: string;
  amountCents: number;
  reference: string;
  description: string;
}): Promise<PaymentRecord> {
  return request<PaymentRecord>('/v1/payments', {
    method: 'POST',
    body: JSON.stringify({
      amount_cents: input.amountCents,
      currency: 'USD',
      reference: input.reference,
      description: input.description,
    }),
    idempotencyKey: input.idempotencyKey,
  });
}

export function fetchPayment(paymentId: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

export function cancelPayment(paymentId: string): Promise<PaymentRecord> {
  return request<PaymentRecord>(`/v1/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}
