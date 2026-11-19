// The console's API client and the Service status region's outage state.
import { isRecord } from "../shared/guards";
import type { ApiErrorBody } from "../shared/types";

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

export const GENERIC_FAILURE = "Something went wrong. Try again.";
export const STORAGE_OUTAGE = "Audio storage is unreachable. Playback and uploads will resume once it's back, and nothing you've typed is lost.";
const BILLING_OUTAGE = "Billing is unreachable. Figures marked Pending will confirm automatically once it's back.";

// ---- outage banners ----
const outages = { storage: false, billing: false };
const outageListeners = new Set<() => void>();

export function outageBanners(): string[] {
  return [outages.billing ? BILLING_OUTAGE : null, outages.storage ? STORAGE_OUTAGE : null].filter((b): b is string => b !== null);
}

export function onOutageChange(listener: () => void): () => void {
  outageListeners.add(listener);
  return () => outageListeners.delete(listener);
}

export function setOutage(kind: keyof typeof outages, down: boolean): void {
  if (outages[kind] === down) return;
  outages[kind] = down;
  outageListeners.forEach((listener) => listener());
}

let onUnauthenticated: () => void = () => undefined;
export function whenSignedOut(handler: () => void): void {
  onUnauthenticated = handler;
}

interface Options {
  /** The call reads or writes object storage: success clears the storage outage banner. */
  storage?: boolean;
  headers?: Record<string, string>;
}

/** The published error shape; anything else (a proxy page, a cut-off reply) reads as the generic failure. */
function errorBodyOf(body: unknown): ApiErrorBody {
  if (!isRecord(body) || typeof body.error !== "string" || typeof body.message !== "string") return { error: "unknown", message: GENERIC_FAILURE };
  const fields: Record<string, string> = {};
  if (isRecord(body.fields)) for (const [name, message] of Object.entries(body.fields)) if (typeof message === "string") fields[name] = message;
  return isRecord(body.fields) ? { error: body.error, message: body.message, fields } : { error: body.error, message: body.message };
}

function settle<T>(status: number, body: unknown, options: Options): Result<T> {
  if (status >= 200 && status < 300) {
    if (options.storage) setOutage("storage", false);
    return { ok: true, status, data: body as T };
  }
  const error = errorBodyOf(body);
  if (error.error === "storage_unavailable") setOutage("storage", true);
  if (status === 401 && error.error === "unauthenticated") onUnauthenticated();
  return { ok: false, status, error };
}

export async function api<T>(method: string, path: string, body?: unknown, options: Options = {}): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? options.headers : { "content-type": "application/json", ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const text = response.status === 204 ? "" : await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return settle<T>(response.status, parsed, options);
  } catch {
    return { ok: false, status: 0, error: { error: "network", message: GENERIC_FAILURE } };
  }
}

/** A multipart upload with progress, through XMLHttpRequest. */
export function upload<T>(path: string, form: FormData, headers: Record<string, string>, onProgress: (fraction: number) => void): Promise<Result<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = null;
      }
      resolve(settle<T>(xhr.status, parsed, { storage: true }));
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, error: { error: "network", message: GENERIC_FAILURE } });
    xhr.send(form);
  });
}

/** Fetches audio bytes for playback; a storage outage shows its banner and resolves to null. */
export async function audioBlob(path: string): Promise<Blob | null> {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      settle(response.status, body, { storage: true });
      return null;
    }
    setOutage("storage", false);
    return await response.blob();
  } catch {
    return null;
  }
}
