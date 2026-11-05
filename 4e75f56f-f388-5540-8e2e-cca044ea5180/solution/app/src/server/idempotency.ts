// Idempotency keys, adapted from kit/modules/idempotency: fingerprint, then replay, refuse or run.
import { createHash } from "node:crypto";
import { one, pool, type Db } from "./db.js";
import { conflict } from "./http.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function keyIsValid(key: string | null): key is string {
  return key !== null && KEY_PATTERN.test(key);
}

export const KEY_ERROR = { idempotency_key: "Send an Idempotency-Key of 8 to 128 letters, digits, - or _." };

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

interface Stored {
  fingerprint: string;
  status: number;
  body: unknown;
}

async function stored(db: Db | typeof pool, accountId: string, key: string): Promise<Stored | null> {
  return one<Stored>(db, "SELECT fingerprint, status, body FROM idempotency_records WHERE account_id = $1 AND key = $2", [accountId, key]);
}

/** The stored response for a completed request with the same key, endpoint and body, if any. */
export async function replayOf(db: Db | typeof pool, accountId: string, key: string, fp: string): Promise<Stored | null> {
  const found = await stored(db, accountId, key);
  return found && found.fingerprint === fp ? found : null;
}

/** 409 idempotency_conflict when the key was used before for a different endpoint or body. */
export async function refuseReuse(db: Db, accountId: string, key: string | null, fp: string): Promise<void> {
  if (!keyIsValid(key)) return;
  const found = await stored(db, accountId, key);
  if (found && found.fingerprint !== fp) throw conflict("idempotency_conflict", "This Idempotency-Key was used for a different request.");
}

export async function remember(accountId: string, key: string, fp: string, status: number, body: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_records (account_id, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id, key) DO NOTHING`,
    [accountId, key, fp, status, JSON.stringify(body)],
  );
}
