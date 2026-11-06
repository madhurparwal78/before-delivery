import { createHash } from "node:crypto";
import { one, query } from "./db";
import { errors, HttpError } from "./http";

// Idempotency keys, scoped to the caller plus method and path. Only a 2xx response is stored; a
// replay with the same body gets it back with `Idempotent-Replayed: true`, a different body is
// refused, and a request whose key is still running waits for it.

export interface Outcome {
  status: number;
  body: unknown;
}

const WAIT_MS = 15_000;
const STALE_MS = 120_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function readKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !/^[\x21-\x7e]{1,200}$/.test(key)) {
    throw errors.invalid({ "Idempotency-Key": "Send an Idempotency-Key header of 1 to 200 visible ASCII characters." });
  }
  return key;
}

interface KeyRow {
  [key: string]: unknown;
  fingerprint: string;
  status: number | null;
  body: unknown;
  created_at: Date;
}

export async function idempotent(
  scope: string,
  key: string,
  method: string,
  path: string,
  body: unknown,
  run: () => Promise<Outcome>,
): Promise<Outcome & { replayed: boolean }> {
  const fingerprint = createHash("sha256").update(`${method}\n${path}\n${canonical(body)}`).digest("hex");
  const identity = [scope, key, method, path];
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const claimed = await query(
      `INSERT INTO idempotency_keys (scope, key, method, path, fingerprint) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [...identity, fingerprint],
    );
    if (claimed.length) break;
    const existing = await one<KeyRow>(
      "SELECT fingerprint, status, body, created_at FROM idempotency_keys WHERE scope = $1 AND key = $2 AND method = $3 AND path = $4",
      identity,
    );
    if (!existing) continue;
    if (existing.fingerprint !== fingerprint) {
      throw new HttpError(409, "idempotency_mismatch", "This Idempotency-Key was already used with a different request.");
    }
    if (existing.status !== null) return { status: existing.status, body: existing.body, replayed: true };
    if (Date.now() - existing.created_at.getTime() > STALE_MS) {
      await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND method = $3 AND path = $4 AND status IS NULL", identity);
      continue;
    }
    if (Date.now() > deadline) throw new HttpError(409, "idempotency_in_progress", "That request is still being processed.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let outcome: Outcome;
  try {
    outcome = await run();
  } catch (error) {
    await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND method = $3 AND path = $4", identity).catch(() => undefined);
    throw error;
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    await query("UPDATE idempotency_keys SET status = $5, body = $6 WHERE scope = $1 AND key = $2 AND method = $3 AND path = $4", [
      ...identity,
      outcome.status,
      JSON.stringify(outcome.body),
    ]);
  } else {
    await query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND method = $3 AND path = $4", identity);
  }
  return { ...outcome, replayed: false };
}
