// Idempotency keys (adapted from kit/modules/idempotency): scoped to the caller and the endpoint, the key row is
// inserted first, and only 200, 201 and 402 answers are kept for replay.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pool } from "./db.js";
import { ApiError, apiError } from "./errors.js";
import type { JsonReply } from "./http.js";

const STORED_STATUSES = new Set([200, 201, 402]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The Idempotency-Key header (1 to 100 characters), or the brief's 400. */
export function requestKey(req: IncomingMessage): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 1 || key.length > 100) throw apiError(400, "idempotency_key_required");
  return key;
}

export async function idempotent(
  scope: string,
  key: string,
  body: unknown,
  run: () => Promise<JsonReply>,
): Promise<JsonReply> {
  const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
  const claimed = await pool.query(
    `INSERT INTO idempotency_keys (scope, key, fingerprint, state) VALUES ($1, $2, $3, 'running')
     ON CONFLICT DO NOTHING`,
    [scope, key, fingerprint],
  );
  if (!claimed.rowCount) {
    const stored = await pool.query<{ fingerprint: string; state: string; status: number; body: unknown }>(
      "SELECT fingerprint, state, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2",
      [scope, key],
    );
    const row = stored.rows[0];
    if (!row) return idempotent(scope, key, body, run);
    if (row.fingerprint !== fingerprint) throw apiError(409, "idempotency_conflict");
    if (row.state === "running") throw apiError(409, "request_in_progress");
    return { status: row.status, body: row.body };
  }
  const keep = async (status: number, answer: unknown) => {
    if (STORED_STATUSES.has(status)) {
      await pool.query(
        "UPDATE idempotency_keys SET state = 'done', status = $3, body = $4 WHERE scope = $1 AND key = $2",
        [scope, key, status, JSON.stringify(answer)],
      );
    } else {
      await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
    }
  };
  try {
    const reply = await run();
    await keep(reply.status, reply.body);
    return reply;
  } catch (error) {
    await keep(error instanceof ApiError ? error.status : 500, error instanceof ApiError ? error.body : null);
    throw error;
  }
}
