import { createHash } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { query, queryOne } from "../db.js";
import { type Ctx } from "../http.js";

export interface IdempotentResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

interface Record {
  request_hash: string;
  status: number | null;
  response_body: unknown;
}

function readKey(ctx: Ctx): string {
  const header = ctx.req.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || key.length < 1 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) {
    throw errors.missingIdempotencyKey();
  }
  return key;
}

function fingerprint(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/** Keys are scoped to the caller plus method and path, and only 2xx answers are stored. */
export async function withIdempotency(
  ctx: Ctx,
  body: unknown,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentResult> {
  const key = readKey(ctx);
  const actor = ctx.user?.id ?? ctx.sessionId ?? "anonymous";
  const scope = `${actor}|${ctx.method}|${ctx.url.pathname}`;
  const hash = fingerprint(body);

  for (let round = 0; round < 2; round += 1) {
    const inserted = await query<{ key: string }>(
      `insert into idempotency_records (scope, key, request_hash) values ($1, $2, $3)
       on conflict (scope, key) do nothing returning key`,
      [scope, key, hash],
    );
    if (inserted.length > 0) {
      try {
        const result = await run();
        await query(
          `update idempotency_records set status = $3, response_body = $4, completed_at = now()
            where scope = $1 and key = $2`,
          [scope, key, result.status, JSON.stringify(result.body)],
        );
        return { ...result, replayed: false };
      } catch (error) {
        await query(`delete from idempotency_records where scope = $1 and key = $2`, [scope, key]);
        throw error;
      }
    }

    const deadline = Date.now() + 15_000;
    for (;;) {
      const stored = await queryOne<Record>(
        `select request_hash, status, response_body from idempotency_records where scope = $1 and key = $2`,
        [scope, key],
      );
      if (!stored) break;
      if (stored.request_hash !== hash) throw errors.idempotencyMismatch();
      if (stored.status !== null) {
        return { status: stored.status, body: stored.response_body, replayed: true };
      }
      if (Date.now() > deadline) {
        throw new ApiError(409, "invalid_transition", "That request is still being processed.");
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new ApiError(409, "invalid_transition", "That request could not be completed.");
}
