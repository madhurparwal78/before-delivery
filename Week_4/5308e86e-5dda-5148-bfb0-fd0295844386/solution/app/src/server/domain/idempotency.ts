/** Idempotency keys: stored in the database with the first success, scoped to company and endpoint, valid for 24 hours. */
import { createHash } from "node:crypto";
import type { Tx } from "../db.js";
import { IDEMPOTENCY_RETENTION_HOURS } from "../../shared/rules.js";
import { refusal } from "../http/errors.js";

interface Outcome {
  status: number;
  /** Serialised once, so a replay is byte-identical to the first answer. */
  body: string;
}

interface KeyedRequest {
  companyId: string;
  endpoint: string;
  key: string | undefined;
  /** The values of every body key the endpoint reads. */
  read: Record<string, unknown>;
  now: Date;
}

function digest(read: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(read)).digest("hex");
}

const RETENTION_MS = IDEMPOTENCY_RETENTION_HOURS * 3_600_000;

/** Runs the operation once per key: a repeat of the same request returns the first answer. */
export async function once(tx: Tx, request: KeyedRequest, operation: () => Promise<{ status: number; body: unknown }>): Promise<Outcome> {
  if (request.key === undefined) {
    const result = await operation();
    return { status: result.status, body: JSON.stringify(result.body) };
  }
  const bodyHash = digest(request.read);
  const claim = () =>
    tx.query(
      `INSERT INTO idempotency_keys (company_id, endpoint, key, body_hash, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (company_id, endpoint, key) DO NOTHING RETURNING 1`,
      [request.companyId, request.endpoint, request.key, bodyHash, request.now],
    );
  const claimed = (await claim()).rowCount === 1;
  if (!claimed) {
    const stored = await tx.query(
      "SELECT body_hash, status, response, created_at FROM idempotency_keys WHERE company_id = $1 AND endpoint = $2 AND key = $3",
      [request.companyId, request.endpoint, request.key],
    );
    const row = stored.rows[0];
    const expired = request.now.getTime() >= (row.created_at as Date).getTime() + RETENTION_MS;
    if (!expired) {
      if (row.body_hash !== bodyHash) throw refusal(422, "idempotency_key_reused");
      return { status: row.status, body: row.response };
    }
    await tx.query("DELETE FROM idempotency_keys WHERE company_id = $1 AND endpoint = $2 AND key = $3", [request.companyId, request.endpoint, request.key]);
    await claim();
  }
  const result = await operation();
  const body = JSON.stringify(result.body);
  await tx.query("UPDATE idempotency_keys SET status = $4, response = $5 WHERE company_id = $1 AND endpoint = $2 AND key = $3", [
    request.companyId,
    request.endpoint,
    request.key,
    result.status,
    body,
  ]);
  return { status: result.status, body };
}
