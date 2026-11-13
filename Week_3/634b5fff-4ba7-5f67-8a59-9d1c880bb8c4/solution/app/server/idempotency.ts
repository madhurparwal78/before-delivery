import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { fail } from "./http.js";

/** One key, one effect: the first request owns the key, repeats get its stored result. */

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

export const fingerprint = (method: string, path: string, body: unknown): string =>
  createHash("sha256").update(`${method}\n${path}\n${canonical(body)}`).digest("hex");

export interface Replay {
  status: number;
  body: Record<string, unknown>;
}

const WAIT_MS = 30000;
const POLL_MS = 100;

/** Returns null when the caller now owns the key, or the stored result of the first request. */
export const begin = async (scope: string, key: string, print: string): Promise<Replay | null> => {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const inserted = await pool.query(
      "INSERT INTO idempotency (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key", [scope, key, print],
    );
    if (inserted.rowCount === 1) return null;
    const stored = await pool.query("SELECT fingerprint, done, status, body FROM idempotency WHERE scope = $1 AND key = $2", [scope, key]);
    const row = stored.rows[0] as { fingerprint: string; done: boolean; status: number; body: Record<string, unknown> } | undefined;
    if (row) {
      if (row.fingerprint !== print) return fail("idempotency_conflict");
      if (row.done) return { status: row.status, body: row.body };
    }
    if (Date.now() > deadline) return fail("idempotency_conflict");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
};

export const finish = async (scope: string, key: string, status: number, body: Record<string, unknown>): Promise<void> => {
  await pool.query("UPDATE idempotency SET done = true, status = $3, body = $4 WHERE scope = $1 AND key = $2", [scope, key, status, body]);
};

/** Releases a key whose request failed before any effect that must not repeat, so the same key can be tried again. */
export const forget = async (scope: string, key: string): Promise<void> => {
  await pool.query("DELETE FROM idempotency WHERE scope = $1 AND key = $2 AND NOT done", [scope, key]);
};
