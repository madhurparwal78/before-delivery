// Idempotency (payments, reversals, buyouts, exchanges).
// In-flight copies wait for the first request with that key and return its
// stored response; the same key with a different body answers 409.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./errors.js";

export interface IdempotencyRequest {
  endpoint: string;
  contractId: string;
  key: string | null;
  body: string;
}

export interface IdempotencyResult {
  replay: boolean;
  status: number;
  body: unknown;
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function validateIdempotencyKey(key: string | null): { ok: boolean; message?: string } {
  if (key === null || key.length === 0) return { ok: false, message: "Send an Idempotency-Key header." };
  if (key.length > 100) return { ok: false, message: "The Idempotency-Key is too long." };
  if (!/^[\x20-\x7E]{1,100}$/.test(key)) return { ok: false, message: "The Idempotency-Key must be printable ASCII." };
  return { ok: true };
}

export class IdempotencyStore {
  // Called inside the action's transaction. Marks the key in flight; a copy
  // that arrives while the first request is still in progress blocks on the
  // unique index until the first commits, then returns its stored answer.
  async begin(client: PoolClient, req: IdempotencyRequest, requestId: string): Promise<IdempotencyResult | null> {
    const bodyHash = hashBody(req.body);
    await client.query("SAVEPOINT idem_begin");
    try {
      await client.query(
        `INSERT INTO idempotency_keys (id, endpoint, contract_id, key, body_hash, status, response_body, created_at)
         VALUES ($1,$2,$3,$4,$5,0,'{}'::jsonb,$6)`,
        [requestId, req.endpoint, req.contractId, req.key, bodyHash, new Date()]
      );
      await client.query("RELEASE SAVEPOINT idem_begin");
      return null;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT idem_begin");
      const existing = await client.query<Record<string, unknown>>(
        "SELECT * FROM idempotency_keys WHERE endpoint = $1 AND contract_id = $2 AND key = $3",
        [req.endpoint, req.contractId, req.key]
      );
      if (existing.rows.length === 0) throw new Error("Idempotency row missing after conflict");
      const row = existing.rows[0];
      if (row.body_hash !== bodyHash) {
        throw ApiError.conflict(
          "idempotency_conflict",
          "That idempotency key was used with different details."
        );
      }
      return {
        replay: true,
        status: row.status as number,
        body: row.response_body,
      };
    }
  }

  async complete(client: PoolClient, endpoint: string, contractId: string, key: string, status: number, body: unknown): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys SET status = $4, response_body = $5, committed_at = $6
        WHERE endpoint = $1 AND contract_id = $2 AND key = $3`,
      [endpoint, contractId, key, status, JSON.stringify(body), new Date()]
    );
  }

  // A 503 is not stored: retrying the key after recovery processes it normally.
  async abandon(client: PoolClient, endpoint: string, contractId: string, key: string): Promise<void> {
    await client.query(
      "DELETE FROM idempotency_keys WHERE endpoint = $1 AND contract_id = $2 AND key = $3",
      [endpoint, contractId, key]
    );
  }
}
