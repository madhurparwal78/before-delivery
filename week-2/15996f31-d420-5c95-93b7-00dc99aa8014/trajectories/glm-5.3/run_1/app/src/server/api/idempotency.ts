import { createHash } from "node:crypto";
import type { Pool } from "../db.ts";
import { one } from "../db.ts";
import { ApiError } from "../errors.ts";

export interface StoredResponse {
  status: number;
  body: unknown;
}

interface KeyRow {
  request_hash: string;
  status: number;
  response_body: StoredResponse;
}

export function idempotencyKeyOf(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers["idempotency-key"];
  if (typeof header !== "string") return null;
  return header;
}

export function hashBody(bodyText: string): string {
  return createHash("sha256").update(bodyText).digest("hex");
}

/**
 * Runs `run` under the published idempotency rules: a stored key replays its
 * response before any state check; the same key with a different body answers
 * 409; only 200 and 202 answers are stored. A failed request may be retried.
 */
export async function idempotent(
  pool: Pool,
  scope: string,
  ref: string,
  key: string | null,
  bodyText: string,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (key) {
    const stored = await one<KeyRow>(
      pool,
      "SELECT request_hash, status, response_body FROM idempotency_keys WHERE scope = $1 AND ref = $2 AND key = $3",
      [scope, ref, key],
    );
    if (stored) {
      if (stored.request_hash !== hashBody(bodyText)) {
        throw new ApiError(409, "idempotency_key_reused", "That request was already sent with different details. Reload and try again.");
      }
      return stored.response_body;
    }
  }
  const response = await run();
  if ((response.status === 200 || response.status === 202) && key) {
    await pool.query(
      `INSERT INTO idempotency_keys (scope, ref, key, request_hash, status, response_body)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [scope, ref, key, hashBody(bodyText), response.status, JSON.stringify(response)],
    );
  }
  return response;
}
