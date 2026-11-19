interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  /** Field errors of a 422, keyed by request field. */
  errors: Record<string, string>;
  /** The `error` code of a failure, such as `stale_task`. */
  code: string;
  headers: Headers;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  return {
    ok: response.ok,
    status: response.status,
    data: data as T,
    errors: (!response.ok && data?.errors) || {},
    code: (!response.ok && data?.error) || "",
    headers: response.headers,
  };
}

export const get = <T>(path: string) => api<T>("GET", path);
