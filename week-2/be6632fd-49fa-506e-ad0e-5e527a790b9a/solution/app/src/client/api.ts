// The browser's one way to the API. Every refusal arrives as the brief's error shape; a network failure or a 5xx
// without its own copy becomes the shared unreachable copy.
import { COPY } from "../shared/copy";

export interface Refusal {
  ok: false;
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  extra: Record<string, unknown>;
}

type Result<T> = { ok: true; status: number; data: T } | Refusal;

const OWN_COPY = new Set(["billing_unavailable", "storage_unavailable"]);

// The device clock may be hours off (brief: Formats → Countdown), so every countdown counts by the server's clock,
// taken from the Date header of each API answer.
let serverOffsetMs = 0;

export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    const multipart = body instanceof FormData;
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || multipart ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "unreachable", message: COPY.unreachable, fields: {}, extra: {} };
  }
  const date = Date.parse(response.headers.get("Date") ?? "");
  if (!Number.isNaN(date)) serverOffsetMs = date + 500 - Date.now();
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as { error?: Record<string, unknown> } | null)?.error;
  if (!error || (response.status >= 500 && !OWN_COPY.has(String(error.code)))) {
    return { ok: false, status: response.status, code: "unreachable", message: COPY.unreachable, fields: {}, extra: {} };
  }
  const { code, message, fields, ...extra } = error;
  return {
    ok: false,
    status: response.status,
    code: String(code),
    message: String(message),
    fields: (fields as Record<string, string> | undefined) ?? {},
    extra,
  };
}
