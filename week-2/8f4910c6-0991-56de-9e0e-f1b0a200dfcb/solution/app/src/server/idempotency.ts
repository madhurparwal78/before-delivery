// Idempotency keys: insert-first pending rows, so a concurrent duplicate waits for the original and replays it.

import { createHash } from "node:crypto";
import { ApiError } from "./errors.js";
import { exec, one, pool } from "./db.js";

const KEEP_MS = 24 * 3600 * 1000;
const WAIT_MS = 30_000;

/** Keys sorted at every depth, no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface IdempotentSlot {
  complete(status: number, body: string): Promise<void>;
  abandon(): Promise<void>;
}

type Begun = { kind: "new"; slot: IdempotentSlot } | { kind: "replay"; status: number; body: string };

export async function beginIdempotent(scope: string, key: string, target: string, body: unknown): Promise<Begun> {
  const fingerprint = createHash("sha256").update(`${target}\n${canonicalJson(body)}`).digest("hex");
  let deadline = Date.now() + WAIT_MS;
  for (;;) {
    const inserted = await exec(
      pool,
      `INSERT INTO idempotency_keys (scope, key, fingerprint, created_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (scope, key) DO NOTHING`,
      [scope, key, fingerprint],
    );
    if (inserted) {
      return {
        kind: "new",
        slot: {
          complete: async (status, text) => {
            await exec(pool, "UPDATE idempotency_keys SET status = $3, body = $4 WHERE scope = $1 AND key = $2", [
              scope, key, status, text,
            ]);
          },
          abandon: async () => {
            await exec(pool, "DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
          },
        },
      };
    }
    const stored = await one<{ fingerprint: string; status: number | null; body: string | null; created_at: Date }>(
      pool,
      "SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE scope = $1 AND key = $2",
      [scope, key],
    );
    if (stored && Date.now() - stored.created_at.getTime() > KEEP_MS) {
      await exec(pool, "DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at = $3", [
        scope, key, stored.created_at,
      ]);
    } else if (stored) {
      if (stored.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_key_reused");
      if (stored.status !== null && stored.body !== null) {
        return { kind: "replay", status: stored.status, body: stored.body };
      }
      if (Date.now() > deadline) {
        // The original request died without finishing; its pending row no longer holds the key.
        await exec(pool, "DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status IS NULL", [scope, key]);
        deadline = Date.now() + WAIT_MS;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
