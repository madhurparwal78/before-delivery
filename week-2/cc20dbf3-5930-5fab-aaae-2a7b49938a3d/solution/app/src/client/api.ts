// Talking to the server: JSON in and out, the one error body turned into an exception the views show.

import type { ErrorBody } from "../shared/api.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

/** The request never got an answer (the network dropped). */
export class NetworkFailure extends Error {}

let onSignedOut: () => void = () => undefined;
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

interface Options {
  json?: unknown;
  form?: FormData;
  key?: string;
}

export async function request<T>(method: "GET" | "POST" | "DELETE", path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.form ?? (options.json === undefined ? null : JSON.stringify(options.json)),
    });
  } catch {
    throw new NetworkFailure("The connection dropped. Try again.");
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;
  const error = (body as ErrorBody | null)?.error;
  if (response.status === 401 && path !== "/api/session") onSignedOut();
  throw new ApiFailure(response.status, error?.code ?? "unknown", error?.message ?? "Something went wrong. Try again.", error?.fields ?? {});
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, json: unknown = {}, key?: string) => request<T>("POST", path, key ? { json, key } : { json });

/** A fresh Idempotency-Key. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Retry keys: a press refused because billing is offline keeps its key, so pressing the same button with the
 * same values sends it again; any other outcome forgets it. */
const keptKeys = new Map<string, string>();

export async function withRetryKey<T>(signature: string, send: (key: string) => Promise<T>): Promise<T> {
  const key = keptKeys.get(signature) ?? newKey();
  try {
    const result = await send(key);
    keptKeys.delete(signature);
    return result;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === "billing_unavailable") keptKeys.set(signature, key);
    else keptKeys.delete(signature);
    throw error;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
