import type { ApiErrorBody } from "../shared/api.js";

// The browser's one fetch layer. Every failed answer is read as the API's single error shape.

const KEY_STORE = "dotgain.key";

export function heldKey(): string | null {
  return localStorage.getItem(KEY_STORE);
}

export function holdKey(key: string): void {
  localStorage.setItem(KEY_STORE, key);
}

/** The API always answers JSON; anything else is read as an internal error in the same shape. */
function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: "internal" };
  }
}

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

let onUnavailable: () => void = () => undefined;

/** Called after any 503 so the service banners refresh at once. */
export function whenUnavailable(callback: () => void): void {
  onUnavailable = callback;
}

interface Options {
  body?: unknown;
  bytes?: Blob;
  headers?: Record<string, string>;
  key?: string | null;
}

export async function api<T>(method: string, path: string, options: Options = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  const key = options.key === undefined ? heldKey() : options.key;
  if (key) headers.Authorization = `Bearer ${key}`;
  let body: BodyInit | undefined;
  if (options.bytes) body = options.bytes;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body });
  } catch {
    return { ok: false, status: 0, error: { error: "network" } };
  }
  const parsed = parseBody(await response.text());
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  if (response.status === 503) onUnavailable();
  return { ok: false, status: response.status, error: parsed as ApiErrorBody };
}

/** Fetches a personal document with the key and hands it to the browser as a download. */
export async function download(path: string, filename: string): Promise<Result<null>> {
  const key = heldKey();
  let response: Response;
  try {
    response = await fetch(path, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  } catch {
    return { ok: false, status: 0, error: { error: "network" } };
  }
  if (!response.ok) return { ok: false, status: response.status, error: parseBody(await response.text()) as ApiErrorBody };
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true, status: 200, data: null };
}

/** A creator-only image (draft media), fetched with the key and shown from a blob URL. */
export async function privateImage(path: string): Promise<string | null> {
  const key = heldKey();
  try {
    const response = await fetch(path, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    return response.ok ? URL.createObjectURL(await response.blob()) : null;
  } catch {
    return null;
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
