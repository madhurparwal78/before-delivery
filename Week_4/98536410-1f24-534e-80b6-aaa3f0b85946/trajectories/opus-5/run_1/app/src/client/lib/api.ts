export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload['code'] ?? 'server_error'));
    this.status = status;
    this.code = String(payload['code'] ?? 'server_error');
    this.payload = payload;
  }

  field(path: string): string | null {
    const errors = this.payload['errors'];
    if (typeof errors !== 'object' || errors === null) return null;
    const value = (errors as Record<string, unknown>)[path];
    return typeof value === 'string' ? value : null;
  }
}

let onSessionEnded: (() => void) | null = null;

export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

export type Options = {
  body?: unknown;
  requestKey?: string;
  raw?: boolean;
  ignoreSessionEnd?: boolean;
};

export async function call<T>(
  method: string,
  path: string,
  options: Options = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.requestKey) headers['request-key'] = options.requestKey;

  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (payload['code'] === 'unauthenticated' && !options.ignoreSessionEnd) onSessionEnded?.();
    throw new ApiFailure(401, payload);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiFailure(response.status, payload);
  }
  if (response.status === 204) return null as T;
  if (options.raw) return (await response.text()) as T;
  return (await response.json()) as T;
}

export const get = <T>(path: string): Promise<T> => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, requestKey?: string): Promise<T> =>
  call<T>('POST', path, requestKey ? { body, requestKey } : { body });
export const put = <T>(path: string, body?: unknown): Promise<T> => call<T>('PUT', path, { body });
export const remove = <T>(path: string): Promise<T> => call<T>('DELETE', path);

export function makeRequestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Guards a sequence of requests so only the latest answer is ever shown. */
export class LatestOnly {
  private token = 0;

  async run<T>(work: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    const mine = ++this.token;
    const value = await work();
    if (mine !== this.token) return;
    apply(value);
  }

  reset(): void {
    this.token += 1;
  }
}
