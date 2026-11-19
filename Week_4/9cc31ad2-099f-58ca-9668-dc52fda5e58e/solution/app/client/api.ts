// Same-origin JSON calls. A request that gets no HTTP response rejects with NoResponse.

export class NoResponse extends Error {}

interface ApiResult<T> {
  readonly status: number;
  readonly data: T;
}

export interface ApiError {
  readonly error: { readonly code: string; readonly message: string; readonly fields?: Record<string, string> };
}

interface CallOptions {
  readonly body?: string;
  readonly key?: string;
  readonly signal?: AbortSignal;
}

export async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: options.body, signal: options.signal, credentials: "same-origin" });
  } catch {
    throw new NoResponse();
  }
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data: data as T };
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return call<T>("GET", path, { signal });
}

export async function send<T>(method: "POST" | "PATCH", path: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  return call<T>(method, path, { body: JSON.stringify(body), signal });
}

export function errorCode(result: ApiResult<unknown>): string | null {
  const data = result.data as Partial<ApiError> | null;
  return data?.error?.code ?? null;
}
