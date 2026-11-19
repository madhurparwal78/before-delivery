import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { memberOf } from './auth.js';
import { idempotencyKeyLive, now } from './clock.js';
import { lockKey, maybeRow, transaction, type Tx } from './db.js';
import { unprocessable } from './errors.js';


export interface Created {
  status: number;
  body: unknown;
}

/**
 * Runs a create inside one transaction. A repeated Idempotency-Key from the same member on the same route
 * returns the stored status and body and creates nothing; the same key with another body is refused.
 * Call it after the handler's not-found checks and before its state and validation checks.
 */
export async function idempotent(request: FastifyRequest, reply: FastifyReply, create: (tx: Tx) => Promise<Created>): Promise<unknown> {
  const key = request.headers['idempotency-key'];
  const member = memberOf(request);
  const result = await transaction(async (tx) => {
    if (typeof key !== 'string' || key === '') return { created: await create(tx), replayed: false };
    const scope = `${request.method} ${request.url.split('?')[0]}`;
    await lockKey(tx, `idempotency:${member.id}:${scope}:${key}`);
    const hash = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('hex');
    const stored = await maybeRow<{ request_hash: string; status: number; response: unknown; created_at: Date }>(
      tx,
      'SELECT request_hash, status, response, created_at FROM idempotency_keys WHERE member_id = $1 AND scope = $2 AND key = $3',
      [member.id, scope, key],
    );
    if (stored && idempotencyKeyLive(stored.created_at, now())) {
      if (stored.request_hash !== hash) throw unprocessable('idempotency_key_reused');
      return { created: { status: stored.status, body: stored.response }, replayed: true };
    }
    const created = await create(tx);
    await tx.query(
      `INSERT INTO idempotency_keys (member_id, scope, key, request_hash, status, response, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (member_id, scope, key) DO UPDATE
         SET request_hash = $4, status = $5, response = $6, created_at = $7`,
      [member.id, scope, key, hash, created.status, JSON.stringify(created.body), now()],
    );
    return { created, replayed: false };
  });
  return reply.status(result.created.status).send(result.created.body);
}
