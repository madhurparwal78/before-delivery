// Same-origin requests. A request that ends without any HTTP reply (network failure, a cut
// connection, or 20 seconds of silence) is reported as `no-reply`, never as a refusal.
import { useRef } from "react";
import type { ApiErrorBody } from "../shared/types";
import { noteServerTime } from "./clock";

const REPLY_TIMEOUT_MS = 20_000;

/** The copy for any action whose request ended without an HTTP reply. */
export const NO_REPLY = "No reply from the server. Showing the last confirmed state.";

export type Outcome<T> =
  | { kind: "ok"; status: number; data: T; headers: Headers }
  | { kind: "refused"; status: number; error: ApiErrorBody }
  | { kind: "no-reply" };

interface Options {
  method?: string;
  body?: unknown;
  raw?: Blob;
  key?: string;
  ifMatch?: number;
}

export async function request<T>(path: string, options: Options = {}): Promise<Outcome<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.raw) headers["Content-Type"] = options.raw.type || "application/octet-stream";
  if (options.key) headers["Idempotency-Key"] = options.key;
  if (options.ifMatch !== undefined) headers["If-Match"] = `"${options.ifMatch}"`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REPLY_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: options.method ?? (options.body !== undefined || options.raw ? "POST" : "GET"),
      headers,
      body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : null),
      credentials: "same-origin",
      signal: abort.signal,
    });
    noteServerTime(response.headers);
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (response.ok) return { kind: "ok", status: response.status, data: parsed as T, headers: response.headers };
    return { kind: "refused", status: response.status, error: parsed as ApiErrorBody };
  } catch {
    return { kind: "no-reply" };
  } finally {
    clearTimeout(timer);
  }
}

export const get = <T>(path: string): Promise<Outcome<T>> => request<T>(path);

const newKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * One keyed control. A key is made when the control is first activated with its current inputs;
 * after a no-reply the same control with unchanged inputs resends that key; a second activation
 * while a request waits sends nothing; changed inputs or any activation after a reply get a new key.
 */
export function useKeyedControl() {
  const state = useRef<{ key: string; inputs: string; lostReply: boolean; waiting: boolean } | null>(null);
  return {
    /** The key to send, or null while an earlier activation is still waiting. */
    begin(inputs: unknown): string | null {
      const fingerprint = JSON.stringify(inputs);
      const last = state.current;
      if (last?.waiting) return null;
      const key = last && last.lostReply && last.inputs === fingerprint ? last.key : newKey();
      state.current = { key, inputs: fingerprint, lostReply: false, waiting: true };
      return key;
    },
    end(outcome: Outcome<unknown>): void {
      if (state.current) state.current = { ...state.current, waiting: false, lostReply: outcome.kind === "no-reply" };
    },
  };
}

/** A guard for unkeyed controls: a second activation while the first waits sends nothing. */
export function useSingleFlight() {
  const waiting = useRef(false);
  return async <T>(run: () => Promise<T>): Promise<T | null> => {
    if (waiting.current) return null;
    waiting.current = true;
    try {
      return await run();
    } finally {
      waiting.current = false;
    }
  };
}
