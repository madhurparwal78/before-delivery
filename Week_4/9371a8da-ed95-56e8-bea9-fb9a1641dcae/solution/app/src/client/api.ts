import type { ApiErrorBody } from "../shared/api.ts";

export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: ApiErrorBody };

/** The request never got an answer: the connection failed or dropped. */
export class NetworkError extends Error {
  constructor() {
    super("network");
  }
}

export async function api<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch {
    throw new NetworkError();
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T, headers: response.headers };
  const error = (parsed && typeof parsed === "object" ? parsed : { error: "internal" }) as ApiErrorBody;
  return { ok: false, status: response.status, error };
}

export const get = <T,>(url: string) => api<T>("GET", url);
export const post = <T,>(url: string, body: unknown = {}, headers?: Record<string, string>) =>
  api<T>("POST", url, body, headers);

/** A fresh retry key for one press of Save. */
export function retryKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A multipart upload; answers like `api`. */
export async function upload<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
    text = await response.text();
  } catch {
    throw new NetworkError();
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T, headers: response.headers };
  return { ok: false, status: response.status, error: (parsed ?? { error: "internal" }) as ApiErrorBody };
}
