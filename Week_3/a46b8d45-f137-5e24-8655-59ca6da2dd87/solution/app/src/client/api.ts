import type { ApiErrorBody } from "../shared/types";

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: ApiErrorBody["error"] | null;
  retryAfter: number | null;
}

async function parse<T>(response: Response): Promise<ApiResult<T>> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    body = null;
  }
  const failed = response.status >= 400;
  const error = failed && typeof body === "object" && body !== null && "error" in body ? (body as ApiErrorBody).error : null;
  const retry = response.headers.get("retry-after");
  return { status: response.status, data: failed ? null : (body as T | null), error, retryAfter: retry ? Number(retry) : null };
}

const unreachable = <T,>(): ApiResult<T> => ({ status: 0, data: null, error: null, retryAfter: null });

export async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  try {
    const sent: Record<string, string> = { ...headers };
    let payload: BodyInit | undefined;
    if (body instanceof FormData || body instanceof Blob || typeof body === "string") payload = body;
    else if (body !== undefined) {
      sent["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (typeof body === "string" || body instanceof Blob) sent["content-type"] = "text/csv";
    return await parse<T>(await fetch(path, { method, headers: sent, body: payload, credentials: "same-origin" }));
  } catch {
    return unreachable<T>();
  }
}

export const get = <T,>(path: string): Promise<ApiResult<T>> => request<T>("GET", path);
export const post = <T,>(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<ApiResult<T>> => request<T>("POST", path, body, headers);
