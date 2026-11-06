// The browser's API client. Outage answers (503) are remembered so the Service status banner can name them.
import { isRecord } from "../shared/graph.js";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(`HTTP ${status}`);
  }
  get code(): string { return typeof this.body.error === "string" ? this.body.error : ""; }
  get fieldErrors(): Record<string, string> {
    const errors = this.body.errors;
    if (!isRecord(errors)) return {};
    return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, String(v)]));
  }
}

export type Outage = "file_storage" | "billing";
const outages = new Set<Outage>();
const listeners = new Set<() => void>();

export function currentOutages(): Outage[] { return [...outages]; }
export function onOutageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setOutage(service: Outage, down: boolean): void {
  if (outages.has(service) === down) return;
  if (down) outages.add(service); else outages.delete(service);
  for (const listener of listeners) listener();
}

/** Routes whose success shows the provider is reachable again. */
function serviceOf(method: string, path: string): Outage | null {
  if (path.startsWith("/api/billing") && path !== "/api/billing") return "billing";
  if (method !== "GET" && /^\/api\/(assets|scenes\/[^/]+\/versions|versions\/[^/]+\/(schedule|exports|thumbnail))/.test(path)) return "file_storage";
  return null;
}

interface RequestOptions { idempotencyKey?: string; raw?: BodyInit; contentType?: string }

export async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined = options.raw;
  if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  if (options.contentType) headers["content-type"] = options.contentType;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  const response = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  const text = await response.text();
  const service = serviceOf(method, path);
  if (!response.ok) {
    const parsed: unknown = text ? JSON.parse(text) : null;
    const errorBody = isRecord(parsed) ? parsed : {};
    if (response.status === 503 && (errorBody.service === "billing" || errorBody.service === "file_storage")) setOutage(errorBody.service, true);
    throw new ApiError(response.status, errorBody);
  }
  if (service) setOutage(service, false);
  const data: T = text ? JSON.parse(text) : null;
  return data;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options);
export const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const del = (path: string) => request<null>("DELETE", path);

/** Lowercase hex from the browser's random source; unlike randomUUID it also works on plain-HTTP origins. */
export const randomHex = (length: number) =>
  [...crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);

/** A fresh key per billing action, so a retry of the same click never charges twice. */
export const newKey = () => randomHex(32);
