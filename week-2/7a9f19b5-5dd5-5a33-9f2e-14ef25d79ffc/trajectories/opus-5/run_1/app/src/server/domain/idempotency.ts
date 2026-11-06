/**
 * One charge per checkout. An `Idempotency-Key` is scoped to the caller and the
 * endpoint. A repeat with the same body replays the stored answer; the same key
 * with a different body is a conflict; a key whose first request is still running
 * is refused. Only 200, 201 and 402 answers are stored, so a retry after a 503 or
 * a 409 is tried again.
 */

import { createHash } from "node:crypto";
import { queryOne, query } from "../db/pool.js";
import { LIMITS } from "../../shared/domain.js";
import {
  idempotencyConflict,
  idempotencyKeyRequired,
  requestInProgress,
  type ApiError,
} from "../http/errors.js";
import type { Ctx } from "../http/context.js";

const REPLAYABLE_STATUSES = [200, 201, 402];

export interface IdempotentOutcome {
  status: number;
  body: unknown;
}

interface RecordRow {
  body_hash: string;
  state: "running" | "done";
  status_code: number | null;
  response_body: unknown;
}

export function requireIdempotencyKey(ctx: Ctx): string {
  const header = ctx.headers["idempotency-key"];
  const key = typeof header === "string" ? header.trim() : "";
  if (key.length < LIMITS.idempotencyKey.min || key.length > LIMITS.idempotencyKey.max) {
    throw idempotencyKeyRequired();
  }
  return key;
}

const hashOf = (body: Buffer): string => createHash("sha256").update(body).digest("hex");

/**
 * Runs `work` at most once for this caller, endpoint and key. Replays the stored
 * answer when the same request arrives again.
 */
export async function runOnce(args: {
  userId: string;
  endpoint: string;
  key: string;
  body: Buffer;
  work: () => Promise<IdempotentOutcome>;
}): Promise<IdempotentOutcome> {
  const bodyHash = hashOf(args.body);

  const claimed = await queryOne<{ key: string }>(
    `INSERT INTO idempotency_records (user_id, endpoint, key, body_hash, state)
     VALUES ($1,$2,$3,$4,'running')
     ON CONFLICT (user_id, endpoint, key) DO NOTHING
     RETURNING key`,
    [args.userId, args.endpoint, args.key, bodyHash],
  );

  if (!claimed) {
    const existing = await queryOne<RecordRow>(
      "SELECT body_hash, state, status_code, response_body FROM idempotency_records WHERE user_id = $1 AND endpoint = $2 AND key = $3",
      [args.userId, args.endpoint, args.key],
    );
    if (!existing) throw requestInProgress();
    if (existing.body_hash !== bodyHash) throw idempotencyConflict();
    if (existing.state === "running") throw requestInProgress();
    return { status: existing.status_code ?? 200, body: existing.response_body };
  }

  let outcome: IdempotentOutcome;
  try {
    outcome = await args.work();
  } catch (error) {
    const status = (error as ApiError).status;
    if (typeof status === "number" && REPLAYABLE_STATUSES.includes(status)) {
      await finish(args, status, (error as ApiError).body());
    } else {
      await release(args);
    }
    throw error;
  }

  if (REPLAYABLE_STATUSES.includes(outcome.status)) {
    await finish(args, outcome.status, outcome.body);
  } else {
    await release(args);
  }
  return outcome;
}

async function finish(
  args: { userId: string; endpoint: string; key: string },
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    `UPDATE idempotency_records SET state = 'done', status_code = $4, response_body = $5
     WHERE user_id = $1 AND endpoint = $2 AND key = $3`,
    [args.userId, args.endpoint, args.key, status, JSON.stringify(body)],
  );
}

async function release(args: { userId: string; endpoint: string; key: string }): Promise<void> {
  await query("DELETE FROM idempotency_records WHERE user_id = $1 AND endpoint = $2 AND key = $3", [
    args.userId,
    args.endpoint,
    args.key,
  ]);
}
