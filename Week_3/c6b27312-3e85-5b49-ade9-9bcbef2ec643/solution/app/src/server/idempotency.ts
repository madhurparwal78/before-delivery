// House rule H8: a key is claimed atomically, a 2xx answer completes it, and any other outcome releases it.
import { canonicalJson } from "../shared/canonical";
import type { User } from "./auth";
import { config } from "./config";
import { db } from "./db";
import { ApiError } from "./errors";
import type { Ctx } from "./http";
import type { Reply } from "./reply";
import { sha256 } from "./solids";

interface StoredRecord {
  fingerprint: string;
  state: "in_progress" | "completed";
  status: number | null;
  location: string | null;
  etag: string | null;
  body: Buffer | null;
  expired: boolean;
}

const inProgress = () => new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed.");
const keyReused = () => new ApiError(422, "key_reused", "This Idempotency-Key was already used for a different request.");

function replayOf(record: StoredRecord): Reply {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  if (record.location) headers.Location = record.location;
  if (record.etag) headers.ETag = record.etag;
  return { status: record.status as number, headers, body: record.body as Buffer };
}

/**
 * Runs `work` once per (caller, method, path, key). Without a key it simply runs. A repeated key replays the
 * stored answer, byte for byte, without running anything again.
 */
export async function idempotent(ctx: Ctx, user: User, work: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.idempotencyKey();
  if (key === null) return work();
  const scope = [user.id, ctx.req.method ?? "POST", ctx.url.pathname, key];
  const fingerprint = sha256(canonicalJson(ctx.json()));
  const release = () => db.run("DELETE FROM idempotency WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4", scope);
  await ctx.claimTurn;
  try {
    for (;;) {
      const claimed = await db.run(
        "INSERT INTO idempotency (user_id, method, path, key, fingerprint, state) VALUES ($1, $2, $3, $4, $5, 'in_progress') ON CONFLICT DO NOTHING",
        [...scope, fingerprint],
      );
      if (claimed === 1) break;
      const record = await db.row<StoredRecord>(
        `SELECT fingerprint, state, status, location, etag, body, created_at < now() - make_interval(secs => $5) AS expired
           FROM idempotency WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4`,
        [...scope, config.idempotencyTtlSeconds],
      );
      if (!record) continue;
      if (record.expired) {
        await release();
        continue;
      }
      if (record.fingerprint !== fingerprint) throw keyReused();
      if (record.state === "in_progress") throw inProgress();
      return replayOf(record);
    }
  } finally {
    ctx.claimed();
  }

  let reply: Reply;
  try {
    reply = await work();
  } catch (error) {
    await release();
    throw error;
  }
  if (reply.status < 200 || reply.status >= 300) {
    await release();
    return reply;
  }
  await db.run(
    `UPDATE idempotency SET state = 'completed', status = $5, location = $6, etag = $7, body = $8
      WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4`,
    [...scope, reply.status, reply.headers?.Location ?? null, reply.headers?.ETag ?? null, reply.body ?? Buffer.alloc(0)],
  );
  return reply;
}
