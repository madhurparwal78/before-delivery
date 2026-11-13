/** The SMS gateway and the UPI and net-banking provider, both behind WireMock. */

import { config } from '../config.js';

const TIMEOUT_MS = 5_000;

async function call(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, {
      method: init.method,
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text === '') return {};
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type SmsTemplate = 'signin_code' | 'signup_code' | 'reset_code' | 'signup_existing';

export async function sendSms(input: {
  to: string;
  template: SmsTemplate;
  code?: string;
}): Promise<boolean> {
  const body: Record<string, string> = {
    to: input.to,
    template: input.template,
    sender: 'CHRAHA',
  };
  if (input.template !== 'signup_existing' && input.code !== undefined) body.code = input.code;
  const reply = await call('/sms/v1/messages', { method: 'POST', body });
  return reply !== null;
}

export type ProviderStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export async function startUpiCollect(input: {
  paymentId: string;
  vpa: string;
  amountPaise: number;
  expiresInSeconds: number;
}): Promise<boolean> {
  const reply = await call('/upi/v1/collect', {
    method: 'POST',
    body: {
      reference: input.paymentId,
      vpa: input.vpa,
      amount_paise: input.amountPaise,
      expires_in_seconds: input.expiresInSeconds,
    },
  });
  return reply !== null;
}

export async function startNetbanking(input: {
  paymentId: string;
  bankCode: string;
  amountPaise: number;
}): Promise<boolean> {
  const reply = await call('/netbanking/v1/payments', {
    method: 'POST',
    body: {
      reference: input.paymentId,
      bank_code: input.bankCode,
      amount_paise: input.amountPaise,
    },
  });
  return reply !== null;
}

function readStatus(reply: unknown): ProviderStatus | null {
  if (reply === null || typeof reply !== 'object') return null;
  const status = (reply as { status?: unknown }).status;
  if (status === 'PENDING' || status === 'SUCCESS' || status === 'FAILED') return status;
  return null;
}

export async function upiStatus(paymentId: string): Promise<ProviderStatus | null> {
  return readStatus(await call(`/upi/v1/collect/${paymentId}`, { method: 'GET' }));
}

export async function netbankingStatus(paymentId: string): Promise<ProviderStatus | null> {
  return readStatus(await call(`/netbanking/v1/payments/${paymentId}`, { method: 'GET' }));
}

export const BANKS = [
  { code: 'SAFB', name: 'Saffron Bank' },
  { code: 'NILB', name: 'Nilgiri Bank' },
  { code: 'DECB', name: 'Deccan Cooperative Bank' },
  { code: 'KONB', name: 'Konkan Bank' },
] as const;
