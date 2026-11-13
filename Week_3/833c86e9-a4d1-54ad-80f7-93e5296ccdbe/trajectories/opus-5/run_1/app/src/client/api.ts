export interface ApiFailure {
  status: number;
  body: Record<string, unknown>;
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`api ${failure.status}`);
  }
}

let pending = 0;

function setPending(delta: number): void {
  pending = Math.max(0, pending + delta);
  document.body.setAttribute('data-pending', String(pending));
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: { bytes: ArrayBuffer | Uint8Array; contentType: string };
  headers?: Record<string, string>;
  busy?: HTMLElement | null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.raw) {
    headers['content-type'] = options.raw.contentType;
    body = options.raw.bytes as BodyInit;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  } else if (method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    body = '{}';
  }
  const busy = options.busy ?? null;
  if (busy) {
    busy.setAttribute('aria-busy', 'true');
    if ('disabled' in busy) (busy as HTMLButtonElement).disabled = true;
  }
  setPending(1);
  try {
    const response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
    const text = await response.text();
    const payload = text === '' ? {} : safeJson(text);
    if (!response.ok) throw new ApiCallError({ status: response.status, body: payload });
    return payload as T;
  } finally {
    setPending(-1);
    if (busy) {
      busy.removeAttribute('aria-busy');
      if ('disabled' in busy) (busy as HTMLButtonElement).disabled = false;
    }
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { raw: text };
  }
}

export function failureOf(err: unknown): ApiFailure | null {
  return err instanceof ApiCallError ? err.failure : null;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
