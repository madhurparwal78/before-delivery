// The one fetch wrapper: JSON in and out, errors as values, storage outages noticed, idempotency keys minted.
import type { ApiError } from "../shared/api";
import { canonicalJson, type Json } from "../shared/canonical";

interface Reply<T> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

type OutageListener = () => void;
const outageListeners = new Set<OutageListener>();

export function notifyStorageOutage(): void {
  outageListeners.forEach((listener) => listener());
}

export function onStorageOutage(listener: OutageListener): () => void {
  outageListeners.add(listener);
  return () => outageListeners.delete(listener);
}

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  key?: string;
}

export async function api<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
    credentials: "same-origin",
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : null) as T;
  if (response.status === 503 && (data as unknown as ApiError | null)?.error === "storage_unavailable") notifyStorageOutage();
  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

export function get<T>(path: string, signal?: AbortSignal): Promise<Reply<T>> {
  return api<T>("GET", path, undefined, { signal });
}

/**
 * A composed action keeps its Idempotency-Key only while the outcome is unknown (a network failure or the
 * in-progress answer) and only while the composed body is unchanged; any definite answer or changed body mints a new one.
 */
export class KeyedAction {
  private key = "";
  private body = "";
  private unknown = false;

  async send<T>(method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply<T> | null> {
    const fingerprint = `${method} ${path} ${canonicalJson(body as Json)} ${canonicalJson(headers)}`;
    if (!this.unknown || this.body !== fingerprint) {
      this.key = crypto.randomUUID();
      this.body = fingerprint;
    }
    this.unknown = true;
    try {
      const reply = await api<T>(method, path, body, { key: this.key, headers });
      this.unknown = reply.status === 409 && (reply.data as unknown as ApiError).error === "idempotency_in_progress";
      return reply;
    } catch {
      return null;
    }
  }
}
