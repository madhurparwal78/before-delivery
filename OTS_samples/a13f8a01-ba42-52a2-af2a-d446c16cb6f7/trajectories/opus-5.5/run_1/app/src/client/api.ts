import type { ErrorBody } from "../shared/types";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ErrorBody };

const unreachable: ErrorBody = { error: "storage_unavailable", message: "The server did not answer." };

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: unreachable };
  }
  const text = await response.text();
  const parsed: unknown = text === "" ? null : safeParse(text);
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: (parsed as ErrorBody | null) ?? unreachable };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function idempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
