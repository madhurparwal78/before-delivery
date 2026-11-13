import { request } from 'node:http';
import { config } from '../config.js';

const DESK_LIMIT_MILLISECONDS = 3_000;

type DeskAnswer<T> =
  | { readonly kind: 'answered'; readonly value: T }
  | { readonly kind: 'refused'; readonly status: number; readonly error: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'unreachable' };

interface DeskCall {
  readonly method: string;
  readonly path: string;
  readonly body?: Record<string, unknown>;
  readonly key?: string;
}

/** Plain node:http, so a refused connection arrives as ECONNREFUSED rather than as a fetch-standard network error. */
function exchange(call: DeskCall): Promise<{ readonly status: number; readonly text: string }> {
  const headers: Record<string, string> = {};
  const payload = call.body === undefined ? undefined : JSON.stringify(call.body);
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (call.key !== undefined) headers['Idempotency-Key'] = call.key;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(call.path, config.wiremockUrl),
      { method: call.method, headers, signal: AbortSignal.timeout(DESK_LIMIT_MILLISECONDS) },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        incoming.on('error', reject);
      },
    );
    outgoing.on('error', reject);
    outgoing.end(payload);
  });
}

const NOTHING_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

async function callDesk<T>(call: DeskCall): Promise<DeskAnswer<T>> {
  let answer: { readonly status: number; readonly text: string };
  try {
    answer = await exchange(call);
  } catch (error) {
    return NOTHING_SENT.has((error as { code?: string }).code ?? '') ? { kind: 'unreachable' } : { kind: 'ambiguous' };
  }
  if (answer.status >= 500) return { kind: 'ambiguous' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.text);
  } catch {
    return { kind: 'ambiguous' };
  }
  if (answer.status >= 400) {
    return { kind: 'refused', status: answer.status, error: (parsed as { error?: string }).error ?? 'refused' };
  }
  return { kind: 'answered', value: parsed as T };
}

interface DeskStock {
  readonly model: string;
  readonly available: number;
  readonly dayRateCents: number;
}

interface DeskHold {
  readonly holdRef: string;
  readonly status: string;
  readonly expiresInSeconds: number;
  readonly serial: string;
  readonly loggedHours: number;
}

interface DeskQuote {
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
