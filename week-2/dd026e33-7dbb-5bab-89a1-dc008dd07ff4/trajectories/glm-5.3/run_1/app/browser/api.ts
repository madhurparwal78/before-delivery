/**
 * API client — same-origin only. Handles the session-expiry protocol and
 * idempotency keys for the four idempotent actions.
 */
export type Units = { film: 'um' | 'mil'; pressure: 'bar' | 'psi'; distance: 'km' | 'mi' };

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'concierge' | 'care_technician' | 'workshop_lead' | 'house_manager' | 'owner';
}

export interface ApiErrorDetail {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  body: unknown;
}

export type SessionEnd = 'access_revoked' | 'session_expired' | 'unauthenticated';

export class ApiFailure extends Error {
  constructor(public detail: ApiErrorDetail) {
    super(detail.code ?? `HTTP ${detail.status}`);
  }
}

export class NoAnswer extends Error {}

interface ApiEvents {
  onSessionEnd(kind: SessionEnd): void;
}

let events: ApiEvents | null = null;

export function setApiEvents(handler: ApiEvents): void {
  events = handler;
}

async function readError(response: Response): Promise<ApiErrorDetail> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return {
    status: response.status,
    code: typeof record['error'] === 'string' ? record['error'] : undefined,
    fields: (record['errors'] ?? undefined) as Record<string, string> | undefined,
    body,
  };
}

async function request(method: string, path: string, options?: { body?: unknown; idempotencyKey?: string; ifMatch?: string; quiet?: boolean }): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options?.ifMatch) headers['If-Match'] = `\"${options.ifMatch}\"`;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new NoAnswer();
  }
  if (response.status === 401) {
    const detail = await readError(response);
    if (!options?.quiet && events) {
      const code = detail.code ?? 'unauthenticated';
      events.onSessionEnd(code as SessionEnd);
    }
    throw new ApiFailure(detail);
  }
  if (!response.ok) {
    throw new ApiFailure(await readError(response));
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get: (path: string): Promise<unknown> => request('GET', path),
  getQuiet: (path: string): Promise<unknown> => request('GET', path, { quiet: true }),
  post: (path: string, body?: unknown, options?: { ifMatch?: string }): Promise<unknown> =>
    request('POST', path, { body, ...(options?.ifMatch ? { ifMatch: options.ifMatch } : {}) }),
  postQuiet: (path: string, body?: unknown): Promise<unknown> =>
    request('POST', path, { body, quiet: true }),
  put: (path: string, body?: unknown): Promise<unknown> => request('PUT', path, { body }),
  postWithKey: (path: string, body: unknown, key: string): Promise<unknown> =>
    request('POST', path, { body, idempotencyKey: key }),
  patch: (path: string, body: unknown, ifMatch?: string): Promise<unknown> =>
    request('PATCH', path, { body, ...(ifMatch ? { headers: { 'If-Match': ifMatch } } : {}) }),
  del: (path: string): Promise<unknown> => request('DELETE', path),
  postForm: async (path: string, formData: FormData): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(path, { method: 'POST', body: formData, credentials: 'same-origin' });
    } catch {
      throw new NoAnswer();
    }
    if (response.status === 401) {
      const detail = await readError(response);
      const code = detail.code ?? 'unauthenticated';
      if (events) events.onSessionEnd(code as SessionEnd);
      throw new ApiFailure(detail);
    }
    if (!response.ok) throw new ApiFailure(await readError(response));
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  },
};

/** One idempotency key per form, held until the server answers. */
export class KeyHolder {
  private key: string | null = null;
  constructor(private generator: () => string) {}
  current(): string {
    if (!this.key) this.key = this.generator();
    return this.key;
  }
  discard(): void {
    this.key = null;
  }
  peek(): string | null {
    return this.key;
  }
}

export function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
