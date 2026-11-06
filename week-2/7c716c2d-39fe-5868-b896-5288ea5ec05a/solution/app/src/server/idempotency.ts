// Idempotency-Key replay (adapted from kit/modules/idempotency): keys are scoped to the person and
// the endpoint, a pending row makes concurrent requests wait, and 503 answers are never stored.
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { one, query, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import type { Reply } from "./http.js";
import { nowMs } from "./time.js";

interface Stored {
  request_hash: string;
  status: number | null;
  body: string | null;
  created_at: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ABANDONED_MS = 30_000;

const STORE = "UPDATE idempotency SET status = $4, body = $5 WHERE person_id = $1 AND endpoint = $2 AND key = $3";

function replyValues(personId: string, endpoint: string, key: string, reply: Reply): unknown[] {
  return [personId, endpoint, key, reply.status, reply.body === undefined ? null : JSON.stringify(reply.body)];
}

export async function withIdempotency(
  personId: string,
  endpoint: string,
  key: string,
  body: unknown,
  run: () => Promise<Reply | void>,
  offerSettle: (settle: (db: Db, reply: Reply) => Promise<void>) => void,
): Promise<Reply | void> {
  if (key.length < 1 || key.length > 100) throw invalid({ "Idempotency-Key": "Use 1 to 100 characters." });
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const ttlMs = config.timers.idempotencyTtl * 1000;
  for (let waited = 0; waited < 30_000; waited += 100) {
    const claimed = await one(
      "INSERT INTO idempotency (person_id, endpoint, key, request_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING key",
      [personId, endpoint, key, hash, nowMs()],
    );
    if (claimed) {
      offerSettle(async (db, reply) => {
        await db.query(STORE, replyValues(personId, endpoint, key, reply));
      });
      return execute(personId, endpoint, key, run);
    }
    const stored = await one<Stored>("SELECT request_hash, status, body, created_at FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [personId, endpoint, key]);
    if (!stored) continue;
    const abandoned = stored.status === null && stored.created_at <= nowMs() - ABANDONED_MS;
    if (abandoned || stored.created_at <= nowMs() - ttlMs) {
      await query("DELETE FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3 AND created_at = $4", [personId, endpoint, key, stored.created_at]);
      continue;
    }
    if (stored.request_hash !== hash) throw new ApiError("idempotency_conflict");
    if (stored.status !== null) {
      return { status: stored.status, body: stored.body === null ? undefined : JSON.parse(stored.body), headers: { "Idempotent-Replay": "true" } };
    }
    await sleep(100);
  }
  throw new ApiError("database_unavailable");
}

async function execute(personId: string, endpoint: string, key: string, run: () => Promise<Reply | void>): Promise<Reply | void> {
  const forget = (): Promise<unknown> => query("DELETE FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [personId, endpoint, key]).catch(() => undefined);
  let reply: Reply;
  try {
    const result = await run();
    if (!result) return result;
    reply = result;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === 503) {
      await forget();
      throw error;
    }
    reply = { status: error.status, body: error.body() };
  }
  if (reply.status === 503) {
    await forget();
    return reply;
  }
  await query(STORE, replyValues(personId, endpoint, key, reply));
  return reply;
}
