import { createHash } from "node:crypto";
import { one, pool } from "./db.js";
import { ApiError, fail, invalid, type Req } from "./http.js";

// Idempotency keys (adapted from kit/modules/idempotency): scoped to the caller and the route, kept 24 h.
// The row is inserted first, so a concurrent repeat finds it in progress; 503 answers are never stored.

const KEY = /^[\x21-\x7e]{1,64}$/;
const DAY_MS = 86_400_000;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function idempotencyKey(req: Req): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY.test(key)) invalid({ idempotency_key: "Send an Idempotency-Key of 1 to 64 visible characters." });
  return key;
}

interface Stored {
  fingerprint: string;
  status: number | null;
  body: unknown;
}

type JsonReply = { status: number; json: Record<string, unknown> };

/** Runs `work` once per (scope, route, key); a repeat with an equal body gets the stored answer minus `key`. */
export async function once(scope: string, route: string, key: string, body: unknown, work: () => Promise<JsonReply>): Promise<JsonReply> {
  const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
  await pool.query("DELETE FROM idempotency WHERE scope = $1 AND route = $2 AND key = $3 AND created_at < $4", [scope, route, key, new Date(Date.now() - DAY_MS)]);
  const inserted = await pool.query(
    "INSERT INTO idempotency (scope, route, key, fingerprint, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    [scope, route, key, fingerprint, new Date()],
  );
  if (!inserted.rowCount) {
    const stored = await one<Stored>(pool, "SELECT fingerprint, status, body FROM idempotency WHERE scope = $1 AND route = $2 AND key = $3", [scope, route, key]);
    if (!stored || stored.fingerprint !== fingerprint) fail(409, "idempotency_conflict");
    if (stored.status === null) fail(409, "idempotency_in_progress");
    return { status: stored.status, json: stored.body as Record<string, unknown> };
  }
  const keep = (status: number, json: unknown) =>
    pool.query("UPDATE idempotency SET status = $4, body = $5 WHERE scope = $1 AND route = $2 AND key = $3", [scope, route, key, status, JSON.stringify(json)]);
  const forget = () => pool.query("DELETE FROM idempotency WHERE scope = $1 AND route = $2 AND key = $3", [scope, route, key]);
  try {
    const reply = await work();
    const { key: _secret, ...replayable } = reply.json;
    await keep(reply.status, replayable);
    return reply;
  } catch (error) {
    if (error instanceof ApiError && error.status !== 503) await keep(error.status, error.body());
    else await forget();
    throw error;
  }
}
