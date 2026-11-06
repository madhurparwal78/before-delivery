// Same-origin requests. Nothing here throws: every call answers with what happened.

import type { ErrorBody } from "../shared/domain.ts";

export type Outcome<T> =
  | { kind: "ok"; status: number; body: T }
  | { kind: "refused"; status: number; code: string; fields: Record<string, string> }
  | { kind: "network" };

interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

function asErrorBody(value: unknown): ErrorBody["error"] | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return null;
  const fields = "fields" in error && typeof error.fields === "object" && error.fields !== null ? Object.fromEntries(Object.entries(error.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  return { code: error.code, message: "", fields };
}

/** The body as the caller expects it; an empty or unreadable body reads as an empty object. */
function parseBody<T>(text: string): T {
  try {
    return JSON.parse(text === "" ? "{}" : text);
  } catch {
    return JSON.parse("{}");
  }
}

async function answer<T>(send: () => Promise<Response>): Promise<Outcome<T>> {
  try {
    const response = await send();
    const parsed = parseBody<T>(await response.text());
    if (response.ok) return { kind: "ok", status: response.status, body: parsed };
    const error = asErrorBody(parsed);
    return { kind: "refused", status: response.status, code: error?.code ?? "unknown", fields: error?.fields ?? {} };
  } catch {
    return { kind: "network" };
  }
}

export function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<Outcome<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined = options.rawBody;
  if (body === undefined && options.body !== undefined) body = JSON.stringify(options.body);
  if (body !== undefined && headers["content-type"] === undefined) headers["content-type"] = "application/json";
  return answer<T>(() => fetch(path, { method, headers, body, credentials: "same-origin" }));
}

export function uploadPdf<T>(path: string, file: Blob, sha256: string): Promise<Outcome<T>> {
  return answer<T>(() => fetch(path, { method: "PUT", headers: { "content-type": "application/pdf", "X-Exhibit-SHA256": sha256 }, body: file, credentials: "same-origin" }));
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
