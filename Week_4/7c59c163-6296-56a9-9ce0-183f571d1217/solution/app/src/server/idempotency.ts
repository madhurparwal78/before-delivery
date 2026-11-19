import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { one, pool } from "./db.js";
import { conflict, HttpError, ProviderDown, unavailable, type Outage } from "./errors.js";
import type { Ctx, Reply } from "./http.js";

// Adapted from kit/modules/idempotency: canonical-JSON fingerprint, key row inserted first so that of
// simultaneous requests exactly one executes, the others wait for and return its stored response.

const KEY_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Runs `execute` once per (member, endpoint, Idempotency-Key); `keyError` carries a malformed key to step 8.
 * Every published response is stored, a provider outage's 503 (`outage`) included, so a replay always returns the first one.
 */
export async function idempotent(
  ctx: Ctx,
  memberId: string,
  endpoint: string,
  outage: Outage | null,
  execute: (keyError: Record<string, string>) => Promise<Reply>,
): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  if (header === undefined) return execute({});
  const key = Array.isArray(header) ? header.join(",") : header;
  if (!KEY_FORMAT.test(key)) return execute({ "Idempotency-Key": "invalid" });
  const fingerprint = createHash("sha256").update(canonical(ctx.body)).digest("hex");
  const inserted = await one<{ key: string }>(
    pool,
    `INSERT INTO idempotency_keys (member_id, endpoint, key, fingerprint) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`,
    [memberId, endpoint, key, fingerprint],
  );
  if (!inserted) return replay(memberId, endpoint, key, fingerprint);
  let reply: Reply;
  try {
    reply = await execute({});
  } catch (error) {
    const published = error instanceof ProviderDown && outage !== null ? unavailable(outage) : error;
    if (!(published instanceof HttpError)) {
      await pool.query("DELETE FROM idempotency_keys WHERE member_id = $1 AND endpoint = $2 AND key = $3", [memberId, endpoint, key]);
      throw error;
    }
    reply = { status: published.status, body: published.body, headers: published.headers };
  }
  await pool.query("UPDATE idempotency_keys SET status = $4, body = $5 WHERE member_id = $1 AND endpoint = $2 AND key = $3", [
    memberId,
    endpoint,
    key,
    reply.status,
    JSON.stringify(reply.body ?? null),
  ]);
  return reply;
}

async function replay(memberId: string, endpoint: string, key: string, fingerprint: string): Promise<Reply> {
  for (let waited = 0; waited < 60_000; waited += 50) {
    const stored = await one<{ fingerprint: string; status: number | null; body: unknown }>(
      pool,
      "SELECT fingerprint, status, body FROM idempotency_keys WHERE member_id = $1 AND endpoint = $2 AND key = $3",
      [memberId, endpoint, key],
    );
    if (!stored) throw conflict("idempotency_conflict");
    if (stored.fingerprint !== fingerprint) throw conflict("idempotency_conflict");
    if (stored.status !== null) return { status: stored.status, body: stored.body, headers: { "Idempotent-Replayed": "true" } };
    await sleep(50);
  }
  throw conflict("idempotency_conflict");
}
