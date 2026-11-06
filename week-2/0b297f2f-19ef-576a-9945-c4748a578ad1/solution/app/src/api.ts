// The browser talks only to the app's own /api, sending the chosen staff id with every request.
import type { Placement } from "./types";

/** The keys an API error carries beside its code and message (brief: API, Error shape). */
interface ErrorDetail {
  fields?: Record<string, string>;
  reason?: string;
  claimedBy?: { id: string; name: string };
  placement?: Placement;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: ErrorDetail,
  ) {
    super(message);
  }

  get fields(): Record<string, string> {
    return this.detail.fields ?? {};
  }
}

let staffId = "";
export function setStaffId(id: string): void {
  staffId = id;
}

/** Mutations in flight and the seq of every change this tab made (never announced as team updates). */
export const own = {
  inflight: 0,
  epoch: 0,
  seqs: new Set<number>(),
};

const idleWaiters: (() => void)[] = [];

/** Resolves once this tab has no mutation in flight. */
export function whenIdle(): Promise<void> {
  if (own.inflight === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** An Idempotency-Key: 128 random bits as hex (getRandomValues works on plain-http origins too). */
function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const mutation = method !== "GET";
  // Every change carries its own key, so a request delivered twice changes things once and this tab
  // still learns the seq of its change (and never announces it as a team update).
  const init: RequestInit = { method, headers: mutation ? { "Idempotency-Key": newKey(), ...headers } : { ...headers } };
  if (staffId) (init.headers as Record<string, string>)["X-Staff-Id"] = staffId;
  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (mutation) {
    own.inflight += 1;
    own.epoch += 1;
  }
  try {
    let res: Response;
    try {
      res = await fetch(path, init);
    } catch {
      throw new ApiFailure(0, "network", "Hangline can't reach the server.", {});
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error = (data as { error?: ErrorDetail & { code?: string; message?: string } } | null)?.error ?? {};
      throw new ApiFailure(res.status, error.code ?? "error", error.message ?? res.statusText, error);
    }
    const seq = (data as { seq?: unknown } | null)?.seq;
    if (mutation && typeof seq === "number") own.seqs.add(seq);
    return data as T;
  } finally {
    if (mutation) {
      own.inflight -= 1;
      own.epoch += 1;
      if (own.inflight === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }
}

export const get = <T>(path: string) => request<T>("GET", path);
