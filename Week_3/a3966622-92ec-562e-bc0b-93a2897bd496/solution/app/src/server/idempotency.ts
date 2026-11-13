// Keyed requests: a key belongs to its user; the same method, path and JSON body (key order and
// whitespace ignored) replays the stored reply, waits on one still running, and anything else
// under that key answers idempotency_conflict.
import { createHash } from "node:crypto";
import { ApiError } from "./errors.js";
import { errorReply, type Reply, type SignedIn } from "./http.js";
import type { Store } from "./store.js";

const KEEP_MS = 48 * 60 * 60 * 1000;

const running = new Map<string, { fingerprint: string; reply: Promise<Reply> }>();

/** JSON with object keys sorted at every depth, so equal bodies hash equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const conflict = (): ApiError =>
  new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different request");

async function settle(perform: () => Reply | Promise<Reply>): Promise<Reply> {
  try {
    return await perform();
  } catch (error) {
    if (error instanceof ApiError) return errorReply(error);
    throw error;
  }
}

/** Runs a keyed route's work once per key; call it after the route's 404 and 403 checks. */
export async function keyed(store: Store, request: SignedIn, perform: () => Reply | Promise<Reply>): Promise<Reply> {
  const key = request.raw.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") return perform();
  const id = sha256(`${request.user.id}\n${key}`);
  const fingerprint = sha256(`${request.method} ${request.url.pathname}\n${canonical(request.body)}`);

  const stored = store.idempotency.get(id);
  if (stored) {
    if (stored.fingerprint !== fingerprint) throw conflict();
    return { status: stored.status, body: JSON.parse(stored.body) as unknown };
  }
  const inFlight = running.get(id);
  if (inFlight) {
    if (inFlight.fingerprint !== fingerprint) throw conflict();
    return inFlight.reply;
  }

  const reply = settle(perform);
  running.set(id, { fingerprint, reply });
  try {
    const result = await reply;
    if (result.status < 500 && result.status !== 202) {
      store.idempotency.put({ id, fingerprint, status: result.status, body: JSON.stringify(result.body), created: Date.now() });
    }
    return result;
  } finally {
    running.delete(id);
  }
}

/** Drops keys older than the 24 hours they must be kept, with a day's margin. */
export function forgetOldKeys(store: Store): void {
  store.db.prepare("DELETE FROM idempotency WHERE created < ?").run(Date.now() - KEEP_MS);
}
