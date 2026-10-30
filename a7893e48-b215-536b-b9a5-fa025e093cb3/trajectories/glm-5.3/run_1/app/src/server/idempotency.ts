import { q } from "./db.js";
import { uid } from "./seed.js";
import { ApiError } from "./errors.js";
import type { SessionUser } from "../shared/types.js";

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function keyError(key: string | undefined): ApiError | null {
  if (key === undefined || key === "" || !KEY_RE.test(key)) {
    return new ApiError(400, "idempotency_key_required", "A valid Idempotency-Key header is required.");
  }
  return null;
}

export interface Stored {
  status: number;
  body: string;
}

/** Try to reserve the key; returns the stored 2xx to replay, or "reused"/"in_progress". */
export async function reserveKey(user: SessionUser, endpoint: string, key: string, body: string): Promise<{ kind: "fresh" } | { kind: "replay"; stored: Stored } | { kind: "reused" } | { kind: "in_progress" }> {
  const err = keyError(key);
  if (err) throw err;
  // Existing?
  const existing = await q(
    `SELECT status, body, request_body, running FROM idempotency_keys WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
    [user.id, endpoint, key],
  );
  const row = existing.rows[0] as { status: number; body: string; request_body: string | null; running: boolean } | undefined;
  if (row) {
    if (row.running) return { kind: "in_progress" };
    if (row.request_body !== body) return { kind: "reused" };
    return { kind: "replay", stored: { status: row.status, body: row.body } };
  }
  const ins = await q(
    `INSERT INTO idempotency_keys (id, user_id, endpoint, key, status, body, request_body, running)
     VALUES ($1,$2,$3,$4,0,'',$5,true)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING RETURNING id`,
    [uid("ik"), user.id, endpoint, key, body],
  );
  if (ins.rowCount === 0) {
    // A concurrent insert happened: re-read.
    const again = await q(
      `SELECT status, body, request_body, running FROM idempotency_keys WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
      [user.id, endpoint, key],
    );
    const row2 = again.rows[0] as { status: number; body: string; request_body: string | null; running: boolean } | undefined;
    if (row2?.running) return { kind: "in_progress" };
    if (row2 && row2.request_body !== body) return { kind: "reused" };
    if (row2) return { kind: "replay", stored: { status: row2.status, body: row2.body } };
    return { kind: "in_progress" };
  }
  return { kind: "fresh" };
}

/** Store a 2xx response for the key, or clear the reservation on error. */
export async function finishKey(user: SessionUser, endpoint: string, key: string, status: number, body: string, ok: boolean): Promise<void> {
  if (ok) {
    await q(
      `UPDATE idempotency_keys SET status=$4, body=$5, running=false WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
      [user.id, endpoint, key, status, body],
    );
  } else {
    await q(
      `DELETE FROM idempotency_keys WHERE user_id=$1 AND endpoint=$2 AND key=$3 AND running`,
      [user.id, endpoint, key],
    );
  }
}

/** Sweep keys older than 24 hours. */
export async function sweepKeys(): Promise<void> {
  await q(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
}
