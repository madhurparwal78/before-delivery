const TOKEN_KEY = 'kinora.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>
  ) {
    super(`api ${status}`);
  }

  get code(): string {
    return typeof this.payload.error === 'string' ? this.payload.error : '';
  }

  get fieldErrors(): Record<string, string> {
    const errors = this.payload.errors;
    return errors && typeof errors === 'object' ? (errors as Record<string, string>) : {};
  }
}

export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export function newIdempotencyKey(): string {
  return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
