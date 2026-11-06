import { query } from "../db.js";
import { ApiError, errors, validationError } from "../errors.js";
import { sha256 } from "../config.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

// Stable JSON: the same body by value hashes the same, whatever the byte order.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export interface IdempotencyOutcome {
  replay: boolean;
  storedStatus?: number;
  storedBody?: unknown;
  headers?: Record<string, string>;
}

export async function beginIdempotent(
  userId: number,
  key: string | undefined,
  body: unknown,
): Promise<IdempotencyOutcome> {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw validationError({ idempotency_key: "required" });
  }
  const hash = sha256(stableStringify(body));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const existing = await query(
      "select * from idempotency_keys where user_id = $1 and key = $2",
      [userId, key],
    );
    const row = existing.rows[0];
    if (row) {
      if (String(row.request_hash) !== hash) {
        throw errors.conflict("idempotency_key_reused");
      }
      if (String(row.status) === "in_progress") {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      return {
        replay: true,
        storedStatus: Number(row.response_status),
        storedBody: row.response_body,
        headers: { "Idempotent-Replay": "true" },
      };
    }
    const inserted = await query(
      `insert into idempotency_keys (user_id, key, request_hash, status)
       values ($1,$2,$3,'in_progress')
       on conflict (user_id, key) do nothing`,
      [userId, key, hash],
    );
    if (inserted.rowCount !== null && inserted.rowCount > 0) {
      return { replay: false };
    }
  }
  throw new ApiError(503, { error: "payment_unavailable" });
}

// 2xx and 4xx responses are stored; a 503 is not, so the same key can run again.
export async function finishIdempotent(
  userId: number,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status === 503) {
    await query("delete from idempotency_keys where user_id = $1 and key = $2", [userId, key]);
    return;
  }
  await query(
    `update idempotency_keys set status = 'done', response_status = $3, response_body = $4::jsonb
     where user_id = $1 and key = $2`,
    [userId, key, status, JSON.stringify(body ?? null)],
  );
}
