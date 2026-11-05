// Idempotent replay: a key belongs to the signed-in person for the life of the database. The same
// method, path and body replays the stored response; anything else with the key is refused.
// Only responses below 500 are stored. A second request with a key that is still running waits.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { db, nowSeconds, one, run, transaction } from "./db.js";
import { ApiError, invalid, type Reply } from "./errors.js";

const KEY = /^[A-Za-z0-9-]{8,64}$/;
const CLAIM_SECONDS = 120;

export function idempotencyKey(req: IncomingMessage, required: boolean): string | null {
  const key = req.headers["idempotency-key"];
  if (key === undefined && !required) return null;
  if (typeof key !== "string" || !KEY.test(key)) {
    throw invalid("idempotency_key", "Send an Idempotency-Key of 8 to 64 letters, digits and hyphens.");
  }
  return key;
}

interface Attempt {
  person: string;
  key: string;
  fingerprint: string;
}

export function attempt(person: string, key: string, req: IncomingMessage, rawBody: string): Attempt {
  const path = new URL(req.url ?? "/", "http://local").pathname;
  const fingerprint = createHash("sha256").update(`${req.method} ${path}\n${rawBody}`).digest("hex");
  return { person, key, fingerprint };
}

interface Stored {
  fingerprint: string;
  status: number | null;
  body: string | null;
  headers: string | null;
  claimed_at: number;
}

type Found = { replay: Reply } | "running" | "free";

function find(a: Attempt): Found {
  const stored = one<Stored>("SELECT * FROM idempotency WHERE person = ? AND key = ?", a.person, a.key);
  if (!stored) return "free";
  if (stored.fingerprint !== a.fingerprint) {
    throw new ApiError(409, "idempotency_key_reused", "That key was already used for a different request.");
  }
  if (stored.status === null) return stored.claimed_at > nowSeconds() - CLAIM_SECONDS ? "running" : "free";
  const headers = { ...(JSON.parse(stored.headers ?? "{}") as Record<string, string>), "Idempotent-Replay": "true" };
  return { replay: { status: stored.status, body: JSON.parse(stored.body ?? "null"), headers } };
}

function store(a: Attempt, reply: Reply): void {
  run(
    `INSERT INTO idempotency (person, key, fingerprint, status, body, headers, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (person, key) DO UPDATE SET status = excluded.status, body = excluded.body, headers = excluded.headers`,
    a.person, a.key, a.fingerprint, reply.status, JSON.stringify(reply.body ?? null), JSON.stringify(reply.headers ?? {}),
    nowSeconds(),
  );
}

function asReply(error: unknown): Reply {
  if (error instanceof ApiError && error.status < 500) return error.toReply();
  throw error;
}

/**
 * Database-only work: the key check, the work and the stored response commit in one transaction,
 * so the same key from any process either waits for the write lock and replays, or does the work.
 * Without a key the work simply runs in a transaction.
 */
export async function idempotentWrite(a: Attempt | null, work: () => Reply): Promise<Reply> {
  if (a === null) return transaction(work);
  for (;;) {
    const outcome = transaction((): Reply | "running" => {
      const found = find(a);
      if (found === "running") return "running";
      if (found !== "free") return found.replay;
      db.exec("SAVEPOINT work");
      let reply: Reply;
      try {
        reply = work();
        db.exec("RELEASE work");
      } catch (error) {
        db.exec("ROLLBACK TO work");
        db.exec("RELEASE work");
        reply = asReply(error);
      }
      store(a, reply);
      return reply;
    });
    if (outcome !== "running") return outcome;
    await sleep(100);
  }
}

/**
 * Work that calls a provider: the key is claimed first and the provider is called outside any
 * transaction. The work resolves to a finishing step whose writes commit together with the stored
 * response. A 5xx releases the claim so the key can be sent again.
 */
export async function idempotentCall(a: Attempt, work: () => Promise<() => Reply>): Promise<Reply> {
  for (;;) {
    const outcome = transaction((): Reply | "running" | "claimed" => {
      const found = find(a);
      if (found === "running") return "running";
      if (found !== "free") return found.replay;
      run(
        `INSERT INTO idempotency (person, key, fingerprint, status, body, headers, claimed_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?)
         ON CONFLICT (person, key) DO UPDATE SET claimed_at = excluded.claimed_at`,
        a.person, a.key, a.fingerprint, nowSeconds(),
      );
      return "claimed";
    });
    if (outcome === "claimed") break;
    if (outcome !== "running") return outcome;
    await sleep(100);
  }
  const release = () => transaction(() => run("DELETE FROM idempotency WHERE person = ? AND key = ?", a.person, a.key));
  let finish: () => Reply;
  try {
    finish = await work();
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      finish = () => error.toReply();
    } else {
      release();
      throw error;
    }
  }
  try {
    return transaction(() => {
      const reply = finish();
      store(a, reply);
      return reply;
    });
  } catch (error) {
    release();
    throw error;
  }
}
