// Repeated requests (Business rules): push and restore keys, scoped to device and endpoint.
// Adapted from kit/modules/idempotency: fingerprint of method, path and body; decide new/replay/conflict.
import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { ApiError, sendJson, type Ctx } from "./http.ts";
import type { Queryable } from "./db.ts";

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

export interface RepeatScope {
  deviceId: string;
  endpoint: string;
  key: string;
  fingerprint: string;
}

/** The scope of a request's Idempotency-Key, or null when the header is missing or malformed. */
export function repeatScope(ctx: Ctx, deviceId: string): RepeatScope | null {
  const key = ctx.req.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY.test(key)) return null;
  const fingerprint = createHash("sha256").update(`${ctx.req.method}\n${ctx.url.pathname}\n`).update(ctx.body).digest("hex");
  return { deviceId, endpoint: ctx.url.pathname, key, fingerprint };
}

export const keyProblem = "Send an Idempotency-Key of 8 to 128 letters, digits, - or _.";

/**
 * Answers a repeat from the stored response and returns true; refuses a reused key with a
 * different body; returns false for a new key.
 */
export async function replayed(db: Queryable, ctx: Ctx, scope: RepeatScope): Promise<boolean> {
  const { rows } = await db.query<{ fingerprint: string; status: number; body: unknown }>(
    `SELECT fingerprint, status, body FROM repeated_requests
     WHERE device_id = $1 AND endpoint = $2 AND key = $3 AND created_at > now() - make_interval(secs => $4)`,
    [scope.deviceId, scope.endpoint, scope.key, config.timers.idempotencyTtl]);
  const stored = rows[0];
  if (!stored) return false;
  if (stored.fingerprint !== scope.fingerprint) {
    throw new ApiError(409, "idempotency_key_reused", "This Idempotency-Key was already used with a different request.");
  }
  sendJson(ctx.res, stored.status, stored.body, { "Cairn-Replayed": "true" });
  return true;
}

/** Stores a 2xx or 4xx answer under the key (503s are never stored, so the key stays free). */
export async function remember(db: Queryable, scope: RepeatScope, status: number, body: unknown): Promise<void> {
  await db.query(
    `INSERT INTO repeated_requests (device_id, endpoint, key, fingerprint, status, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (device_id, endpoint, key) DO UPDATE SET fingerprint = $4, status = $5, body = $6, created_at = now()
     WHERE repeated_requests.created_at <= now() - make_interval(secs => $7)`,
    [scope.deviceId, scope.endpoint, scope.key, scope.fingerprint, status, body, config.timers.idempotencyTtl]);
}
