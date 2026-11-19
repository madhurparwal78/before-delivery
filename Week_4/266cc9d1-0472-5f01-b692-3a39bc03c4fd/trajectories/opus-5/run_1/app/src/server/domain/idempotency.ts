/**
 * Idempotency records. The same key with the same body returns the first
 * response unchanged; a different body conflicts; concurrent requests with one
 * key produce one effect and all receive that one response.
 */

import { createHash } from "node:crypto";
import { isUniqueViolation, query, queryOne } from "../db.js";
import { ApiError, idempotencyConflict } from "../errors.js";
import type { RouteResult } from "../http.js";

const WAIT_STEP_MS = 40;
const WAIT_LIMIT_MS = 20_000;

/** Bodies are compared as parsed JSON, ignoring whitespace and key order. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalise(item)]),
    );
  }
  return value;
}

function bodyHash(body: unknown): string {
  const normalised = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  return createHash("sha256").update(JSON.stringify(canonicalise(normalised ?? {}))).digest("hex");
}

interface RecordRow {
  body_hash: string;
  status: number | null;
  response: string | null;
}

/** The first response is replayed byte for byte. */
function stored(row: RecordRow): RouteResult {
  const status = row.status!;
  if (row.response === null) return { status };
  const bytes = new TextEncoder().encode(row.response);
  return {
    status,
    raw: {
      bytes,
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(bytes.byteLength),
      },
    },
  };
}

export async function replayOrRun(
  scope: string,
  route: string,
  key: string,
  body: unknown,
  run: () => Promise<RouteResult>,
): Promise<RouteResult> {
  const hash = bodyHash(body);

  try {
    await query(
      `INSERT INTO idempotency_records (scope, route, key, body_hash)
       VALUES ($1,$2,$3,$4)`,
      [scope, route, key, hash],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await waitForRecord(scope, route, key);
    if (existing.body_hash !== hash) throw idempotencyConflict();
    if (existing.status === null) throw idempotencyConflict();
    return stored(existing);
  }

  try {
    const result = await run();
    await finish(
      scope,
      route,
      key,
      result.status,
      result.body === undefined ? null : JSON.stringify(result.body),
    );
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await finish(scope, route, key, error.status, JSON.stringify(error.body()));
      throw error;
    }
    await query("DELETE FROM idempotency_records WHERE scope = $1 AND route = $2 AND key = $3", [
      scope,
      route,
      key,
    ]);
    throw error;
  }
}

async function finish(
  scope: string,
  route: string,
  key: string,
  status: number,
  response: string | null,
): Promise<void> {
  await query(
    `UPDATE idempotency_records SET status = $4, response = $5
     WHERE scope = $1 AND route = $2 AND key = $3`,
    [scope, route, key, status, response],
  );
}

async function waitForRecord(scope: string, route: string, key: string): Promise<RecordRow> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const row = await queryOne<RecordRow>(
      "SELECT body_hash, status, response FROM idempotency_records WHERE scope = $1 AND route = $2 AND key = $3",
      [scope, route, key],
    );
    if (!row) throw idempotencyConflict();
    if (row.status !== null || Date.now() > deadline) return row;
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

/** Records are kept for 24 hours. */
export async function pruneIdempotency(): Promise<void> {
  await query("DELETE FROM idempotency_records WHERE created_at < now() - interval '24 hours'");
}
