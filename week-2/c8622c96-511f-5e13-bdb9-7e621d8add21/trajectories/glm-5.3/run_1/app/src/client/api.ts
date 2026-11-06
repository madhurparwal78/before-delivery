// Thin typed API client. Fetch failures surface as { network: true } so the
// page can show the honest no-answer copy and keep the idempotency key.
export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  [key: string]: unknown;
}

export interface ApiResult<T> {
  status: number;
  body: T | { error: ApiError };
  ok: boolean;
  network?: boolean;
}

async function request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; raw?: boolean } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  for (const [k, v] of Object.entries(options.headers ?? {})) headers[k] = v;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? (method === "POST" || method === "PUT" || method === "PATCH" ? "{}" : undefined) : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    return { status: 0, body: null as never, ok: false, network: true };
  }
  let body: unknown;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T | { error: ApiError }, ok: res.ok && res.status !== 409 };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> => request<T>("POST", path, { body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> => request<T>("PATCH", path, { body, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> => request<T>("PUT", path, { body, headers }),
  delete: <T>(path: string): Promise<ApiResult<T>> => request<T>("DELETE", path),
  postForm: <T>(path: string, formData: FormData): Promise<ApiResult<T>> =>
    request<T>("POST", path, { body: formData, raw: true }),
};

export function errorOf<T>(result: ApiResult<T>): ApiError | null {
  const body = result.body as { error?: ApiError } | null;
  if (body && typeof body === "object" && "error" in body && body.error) return body.error;
  return null;
}
