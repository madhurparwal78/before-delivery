// The browser's one way to reach the API. Every refusal comes back as data, never as a thrown error.
import { COPY } from "../../shared/copy";

export interface ApiError {
  error?: string;
  errors?: Record<string, string>;
  [key: string]: unknown;
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; body: ApiError };

type Listener = (kind: "session_ended" | "access_removed") => void;
const listeners = new Set<Listener>();

/** Screens learn that the session ended or access was removed, so typed values can be kept. */
export function onSessionLoss(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function api<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, body: { error: "network" } };
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.ok) return { ok: true, status: res.status, data: parsed as T };
  const error = (parsed ?? {}) as ApiError;
  if (res.status === 401 && (error.error === "session_ended" || error.error === "access_removed")) {
    for (const listener of listeners) listener(error.error);
  }
  return { ok: false, status: res.status, body: error };
}

/** The published copy for refusals every screen shares; screen-specific codes are mapped by the screen. */
export function sharedCopy(result: { status: number; body: ApiError }): string {
  switch (result.body.error) {
    case "session_ended":
    case "unauthenticated":
      return COPY.sessionEnded;
    case "access_removed":
      return COPY.accessRemoved;
    case "billing_unavailable":
      return COPY.invoicingOutage;
    case "mail_unavailable":
      return COPY.mailOutage;
    case "storage_unavailable":
      return COPY.storageOutage;
    case "date_exists":
      return COPY.dateExists;
    default:
      return COPY.unexpected;
  }
}
