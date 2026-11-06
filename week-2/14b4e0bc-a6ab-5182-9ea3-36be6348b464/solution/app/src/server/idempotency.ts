import { createHash } from "node:crypto";
import { pool } from "./db.ts";
import { conflict, inPrecedence, invalid, type Checks } from "./errors.ts";
import type { Context, Reply } from "./http.ts";

const KEY = /^[A-Za-z0-9_-]{1,100}$/;

export function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

interface IdempotentRun {
  /** Reads the body as needed and returns its fingerprint. */
  fingerprint(): Promise<string>;
  /** The route's existence and permission checks, which outrank a fingerprint conflict. */
  access: Checks;
  /** The request itself; only a 2xx reply is stored. */
  run(): Promise<Reply>;
}

/**
 * Idempotency-Key handling (DP-55), scoped to caller, route and asset: an exact replay returns the
 * stored reply, a key still running answers 409 in progress, a different request under a used key
 * answers 409 conflict, and a failed request frees its key.
 */
export async function idempotent(ctx: Context, route: string, assetId: string, request: IdempotentRun): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  if (header === undefined) return request.run();
  const key = Array.isArray(header) ? header[0] : header;
  if (!KEY.test(key)) throw invalid({ idempotency_key: "Use 1 to 100 letters, digits, hyphens or underscores." });
  const scope = [ctx.actor.id, route, assetId, key];
  const claimed = await pool.query(
    `insert into idempotency(user_id, route, asset_id, key, state) values ($1, $2, $3, $4, 'running')
     on conflict do nothing returning key`,
    scope,
  );
  if (!claimed.rowCount) {
    const { rows } = await pool.query(
      "select state, fingerprint, status, body from idempotency where user_id = $1 and route = $2 and asset_id = $3 and key = $4",
      scope,
    );
    const stored = rows[0];
    const replayed = await inPrecedence<Reply>({
      ...request.access,
      async replay() {
        if (!stored || stored.state === "running") {
          throw conflict("idempotency_in_progress", "A request with this Idempotency-Key is still in progress. Retry shortly.");
        }
        if ((await request.fingerprint()) === stored.fingerprint) return { status: stored.status, body: stored.body };
      },
      state() {
        throw conflict("idempotency_conflict", "This Idempotency-Key was already used with a different request.");
      },
    });
    return replayed!;
  }
  try {
    const reply = await request.run();
    await pool.query(
      `update idempotency set state = 'done', fingerprint = $5, status = $6, body = $7
       where user_id = $1 and route = $2 and asset_id = $3 and key = $4`,
      [...scope, await request.fingerprint(), reply.status, JSON.stringify(reply.body)],
    );
    return reply;
  } catch (error) {
    await pool.query("delete from idempotency where user_id = $1 and route = $2 and asset_id = $3 and key = $4", scope);
    throw error;
  }
}
