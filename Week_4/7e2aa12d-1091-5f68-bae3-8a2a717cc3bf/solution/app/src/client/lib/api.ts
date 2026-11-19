export interface ApiResult<T> {
  status: number;
  body: T;
}

/** The server could not be reached at all. */
export class Unreachable extends Error {}

export async function request<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Unreachable();
  }
  if (response.status >= 502) throw new Unreachable();
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export interface ErrorBody {
  error: string;
  message?: string;
}

/** A path on this app's own origin starting with a single `/`; anything else is ignored. */
export function safeNext(value: string | null): string | null {
  if (!value || value[0] !== '/' || value[1] === '/' || value[1] === '\\') return null;
  return new URL(value, window.location.origin).origin === window.location.origin ? value : null;
}
