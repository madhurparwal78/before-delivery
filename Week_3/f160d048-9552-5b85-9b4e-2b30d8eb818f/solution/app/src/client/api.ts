export type ApiFailure = { status: number; error: string; message: string; fields?: Record<string, string>; field?: string };
export type ApiResult<T> = ({ ok: true; status: number; data: T }) | ({ ok: false } & ApiFailure);

const OFFLINE: ApiFailure = {
  status: 0,
  error: "offline",
  message: "We could not reach the server. Check your connection and try again.",
};

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const isRaw = body instanceof FormData || body instanceof Blob;
  try {
    const response = await fetch(path, {
      method,
      headers: { ...(body === undefined || isRaw ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
    });
    if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
    const text = await response.text();
    const parsed: unknown = text === "" ? undefined : JSON.parse(text);
    if (response.ok) return { ok: true, status: response.status, data: parsed as T };
    const failure = (parsed ?? {}) as Partial<ApiFailure>;
    return {
      ok: false,
      status: response.status,
      error: failure.error ?? "error",
      message: failure.message ?? OFFLINE.message,
      fields: failure.fields,
      field: failure.field,
    };
  } catch {
    return { ok: false, ...OFFLINE };
  }
}

export const get = <T,>(path: string) => api<T>("GET", path);
export const post = <T,>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>("POST", path, body, headers);
