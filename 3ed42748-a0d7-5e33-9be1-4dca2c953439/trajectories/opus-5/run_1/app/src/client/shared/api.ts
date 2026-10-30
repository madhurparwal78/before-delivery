export interface ApiFields {
  [field: string]: string;
}

export class ApiFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly sentence: string,
    readonly fields: ApiFields | null,
    readonly headers: Headers,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiFault';
  }
}

/** No HTTP answer came back at all, so the request may or may not have been seen. */
export class Unreachable extends Error {
  constructor() {
    super('unreachable');
    this.name = 'Unreachable';
  }
}

export interface Answer<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  json?: unknown;
  raw?: Blob | ArrayBuffer;
  contentType?: string;
  headers?: Record<string, string>;
}

let serverClockOffsetMs = 0;

/** The server's clock, as judged from the `Date` header of the latest answer. */
export function serverNow(): number {
  return Date.now() + serverClockOffsetMs;
}

function readServerClock(headers: Headers): void {
  const date = headers.get('date');
  if (date === null) return;
  const stamp = Date.parse(date);
  if (!Number.isNaN(stamp)) serverClockOffsetMs = stamp - Date.now();
}

export async function request<T = unknown>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Answer<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.raw !== undefined) {
    headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
    body = options.raw;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new Unreachable();
  }
  readServerClock(response.headers);
  const text = await response.text();
  const parsed = text.length === 0 ? null : safeParse(text);
  if (!response.ok) {
    const shape = parsed as { error?: { code?: string; message?: string; fields?: ApiFields } } | null;
    throw new ApiFault(
      response.status,
      shape?.error?.code ?? 'internal',
      shape?.error?.message ?? 'Something went wrong on Bramble.',
      shape?.error?.fields ?? null,
      response.headers,
    );
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const TICKET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newTicket(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => TICKET_ALPHABET[byte % TICKET_ALPHABET.length]).join('');
}

export const RETRY_LIMIT = 3;
export const RETRY_PAUSE_MS = 1000;

export interface RetryHooks {
  onRetry?: () => void;
}

/**
 * Sends a request that must count once: a network failure is retried up to three times with the
 * identical request, about a second apart.
 */
export async function withRetries<T>(
  send: () => Promise<Answer<T>>,
  hooks: RetryHooks = {},
): Promise<Answer<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (fault) {
      if (!(fault instanceof Unreachable) || attempt >= RETRY_LIMIT) throw fault;
      hooks.onRetry?.();
      await new Promise((resume) => setTimeout(resume, RETRY_PAUSE_MS));
    }
  }
}
