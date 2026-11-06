// The browser's only door to the server: same-origin JSON (or multipart) over fetch.

import type { ErrorBody } from "../shared/api.js";

export type ApiFailure = ErrorBody & Record<string, unknown>;

type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiFailure };

interface Request {
  method?: "GET" | "POST" | "DELETE";
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

let onSignedOut: () => void = () => undefined;

/** Called when a signed-in request answers 401 (the session ended elsewhere). */
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

export async function api<T>(path: string, request: Request = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...request.headers };
  let body: BodyInit | undefined;
  if (request.form) body = request.form;
  else if (request.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.json);
  }
  let response: Response;
  try {
    response = await fetch(path, { method: request.method ?? "GET", headers, body, credentials: "same-origin", redirect: "manual" });
  } catch {
    return { ok: false, status: 0, error: { error: "network" } };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  if (response.status === 401 && path !== "/api/session" && path !== "/api/me") onSignedOut();
  const code = parsed !== null && typeof parsed === "object" ? Reflect.get(parsed, "error") : undefined;
  const error: ApiFailure = typeof code === "string" && parsed !== null && typeof parsed === "object" ? { ...Object.fromEntries(Object.entries(parsed)), error: code } : { error: "unexpected" };
  return { ok: false, status: response.status, error };
}
