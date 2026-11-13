import { config } from '../config.js';

const DESK_LIMIT_MILLISECONDS = 3_000;

export type DeskAnswer<T> =
  | { readonly kind: 'answered'; readonly value: T }
  | { readonly kind: 'refused'; readonly error: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'unreachable' };

interface DeskCall {
  readonly method: string;
  readonly path: string;
  readonly body?: Record<string, unknown>;
  readonly key?: string;
}

async function callDesk<T>(call: DeskCall): Promise<DeskAnswer<T>> {
  const headers: Record<string, string> = {};
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';
  if (call.key !== undefined) headers['Idempotency-Key'] = call.key;
  let response: Response;
  try {
    response = await fetch(`${config.wiremockUrl}${call.path}`, {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(DESK_LIMIT_MILLISECONDS),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') {
      return { kind: 'unreachable' };
    }
    return { kind: 'ambiguous' };
  }
  const text = await response.text();
  if (response.status >= 500) return { kind: 'ambiguous' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'ambiguous' };
  }
  if (response.status >= 400) {
    const error = (parsed as { error?: string }).error;
    return { kind: 'refused', error: error ?? 'refused' };
  }
  return { kind: 'answered', value: parsed as T };
}

export interface DeskStock {
  readonly model: string;
  readonly available: number;
  readonly dayRateCents: number;
}

export interface DeskHold {
  readonly holdRef: string;
  readonly status: string;
  readonly expiresInSeconds: number;
  readonly serial: string;
  readonly loggedHours: number;
}

export interface DeskQuote {
  readonly dayRateCents: number;
  readonly days: number;
  readonly factorPermille: number;
  readonly netCents: number;
  readonly vatCents: number;
  readonly totalCents: number;
}

export function askStock(model: string, from: string, days: number): Promise<DeskAnswer<DeskStock>> {
  const search = new URLSearchParams({ model, from, days: String(days) });
  return callDesk<DeskStock>({ method: 'GET', path: `/v1/stock?${search.toString()}` });
}

export function askHold(model: string, from: string, days: number, key: string): Promise<DeskAnswer<DeskHold>> {
  return callDesk<DeskHold>({ method: 'POST', path: '/v1/holds', body: { model, from, days }, key });
}

export function askQuote(holdRef: string, days: number): Promise<DeskAnswer<DeskQuote>> {
  return callDesk<DeskQuote>({ method: 'POST', path: '/v1/quotes', body: { holdRef, days } });
}

export function askConfirm(holdRef: string, totalCents: number, key: string): Promise<DeskAnswer<{ status: string }>> {
  return callDesk<{ status: string }>({
    method: 'POST',
    path: `/v1/holds/${holdRef}/confirm`,
    body: { totalCents },
    key,
  });
}

export function askRelease(holdRef: string): Promise<DeskAnswer<{ status: string }>> {
  return callDesk<{ status: string }>({ method: 'POST', path: `/v1/holds/${holdRef}/release` });
}
