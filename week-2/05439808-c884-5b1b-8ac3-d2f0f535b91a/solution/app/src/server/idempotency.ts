// Idempotency-Key handling for start-raid, deploy and finalize. The first response below 500 is
// stored with the parsed request body; a repeat with the same body replays it before any state check.
import { now } from './clock';
import { tx, type Db } from './db';
import { ApiError, fail } from './errors';
import { errorReply, type Reply, type SignedInCtx } from './http';
import { MESSAGES, rejectField } from './validate';

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Runs `checks` (404 and 403 answers, never stored), then the key lookup, then `work`
 * inside a savepoint so a refused request can still store its answer.
 */
export async function idempotent(
  ctx: SignedInCtx,
  checks: (db: Db) => Promise<void>,
  work: (db: Db) => Promise<Reply>,
): Promise<Reply> {
  const header = ctx.headers['idempotency-key'];
  const body = ctx.body === undefined ? {} : ctx.body;
  return tx(async (db) => {
    await checks(db);
    if (typeof header !== 'string' || !KEY.test(header)) rejectField('Idempotency-Key', MESSAGES.idempotencyKey);
    const key = header as string;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 11))', [`${ctx.account.id}:${ctx.method}:${ctx.path}:${key}`]);
    const { rows } = await db.query<{ same: boolean; status: number; response: unknown }>(
      `SELECT request_body = $5::jsonb AS same, status, response FROM idempotency_records
        WHERE account_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
      [ctx.account.id, ctx.method, ctx.path, key, JSON.stringify(body)],
    );
    const stored = rows[0];
    if (stored) {
      if (!stored.same) fail('idempotency_key_reused');
      return { status: stored.status, body: stored.response, headers: { 'Idempotent-Replayed': 'true' } };
    }
    await db.query('SAVEPOINT idempotent_work');
    let reply: Reply;
    try {
      reply = await work(db);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      await db.query('ROLLBACK TO SAVEPOINT idempotent_work');
      reply = errorReply(error);
    }
    await db.query(
      `INSERT INTO idempotency_records (account_id, method, path, idem_key, request_body, status, response, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)`,
      [ctx.account.id, ctx.method, ctx.path, key, JSON.stringify(body), reply.status, JSON.stringify(reply.body ?? null), now()],
    );
    return reply;
  });
}
