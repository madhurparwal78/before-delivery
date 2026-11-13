// A fetch wrapper that tracks the latest request per tag, so a response that arrives after a
// newer request on the same data is discarded (the stale-refetch rule).
import type { ApiErrorBody } from '../shared/api.js';

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

export class ApiFailure extends Error {
  code: string;
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
    this.code = body.error;
  }
}

export class NetworkFailure extends Error {
  request: ApiFetchOptions;

  constructor(request: ApiFetchOptions) {
    super('network');
    this.request = request;
  }
}

/** An inflight-tracking fetch wrapper. Each call can be tagged so responses that arrive
 * after a newer request on the same data are discarded (the DP-60 rule). */
export class Api {
  private inflight = new Map<string, number>();
  private counter = 0;

  async call<T>(path: string, opts: ApiFetchOptions & { tag?: string } = {}): Promise<T> {
    const tag = opts.tag ?? path;
    const seq = ++this.counter;
    this.inflight.set(tag, seq);
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(path, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'same-origin',
      });
    } catch {
      if (this.inflight.get(tag) === seq) this.inflight.delete(tag);
      throw new NetworkFailure(opts);
    }
    if (this.inflight.get(tag) !== seq) {
      // A newer request superseded this one; the response is discarded.
      throw new StaleResponse();
    }
    this.inflight.delete(tag);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    if (!response.ok) {
      const body = (parsed ?? { error: 'unknown', message: 'The request failed.' }) as ApiErrorBody;
      throw new ApiFailure(response.status, body);
    }
    return parsed as T;
  }
}

export class StaleResponse extends Error {
  constructor() {
    super('stale');
  }
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
