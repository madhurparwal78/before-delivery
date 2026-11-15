import { sha256Hex, type UserRow } from "./auth";
import { one, pool } from "./db";
import { ApiError, validation } from "./errors";
import { json, type Context, type Reply } from "./http";

const inFlight = new Map<string, Promise<unknown>>();

async function serialised<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(lockKey) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  inFlight.set(lockKey, current);
  try {
    return await current;
  } finally {
    if (inFlight.get(lockKey) === current) inFlight.delete(lockKey);
  }
}

/** Replays a stored 201 for the same caller, route and key, or runs the work and stores its 201. */
export async function withIdempotency(ctx: Context, user: UserRow, penId: string, work: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.req.headers["idempotency-key"];
  if (key === undefined) return work();
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,64}$/.test(key)) throw validation({ idempotency_key: "Use 1 to 64 visible ASCII characters." });
  const routeKey = `${ctx.req.method} ${ctx.url.pathname}`;
  const bodyHash = sha256Hex(ctx.rawBody);
  return serialised(`${user.id} ${routeKey} ${key}`, async () => {
    const stored = await one<{ body_hash: string; status: number; response: string }>(
      pool,
      "SELECT body_hash, status, response FROM idempotency_records WHERE user_id = $1 AND route = $2 AND key = $3 AND created_at > now() - interval '24 hours'",
      [user.id, routeKey, key],
    );
    if (stored) {
      if (stored.body_hash !== bodyHash) throw new ApiError("idempotency_conflict");
      return json(stored.status, JSON.parse(stored.response));
    }
    const reply = await work();
    if (reply.kind === "json" && reply.status === 201) {
      await pool.query(
        `INSERT INTO idempotency_records (user_id, route, key, pen_id, body_hash, status, response) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, route, key) DO UPDATE SET body_hash = EXCLUDED.body_hash, status = EXCLUDED.status, response = EXCLUDED.response, created_at = now()`,
        [user.id, routeKey, key, penId, bodyHash, reply.status, JSON.stringify(reply.body)],
      );
    }
    return reply;
  });
}
