// Same-origin JSON calls. A refusal keeps its body; a network failure has none.
import type { ErrorBody } from "../../shared/api.js";

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ErrorBody | null };

interface Options {
  body?: unknown;
  form?: FormData | Multipart;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T>(method: string, path: string, options: Options = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.form instanceof FormData) body = options.form;
  else if (options.form) {
    headers["Content-Type"] = options.form.contentType;
    body = options.form.bytes;
  }
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body } : {}), ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: null };
  }
  const text = await response.text().catch(() => "");
  const parsed: unknown = text ? safeJson(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: isErrorBody(parsed) ? parsed : null };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

interface Multipart {
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** A random token for request keys and multipart boundaries; unlike crypto.randomUUID, it works on plain-http origins. */
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A multipart/form-data body as plain bytes (used for plucked stills, so the request carries no Blob stream). */
export async function multipart(fields: Record<string, string>, file: { name: string; filename: string; type: string; blob: Blob }): Promise<Multipart> {
  const boundary = `rushes-${randomToken()}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(new Uint8Array(await file.blob.arrayBuffer()));
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes };
}
