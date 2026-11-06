import { ERRORS } from './errors.ts';
import { bodyHash, claimIdempotency, storeIdempotentResponse } from './idem.ts';
import type { Tx } from './db.ts';
import type { RouteContext } from './router.ts';

export interface IdemResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * The single idempotency pipeline. Runs the handler inside one transaction
 * that holds the claim: a concurrent duplicate blocks on the claim and then
 * returns the same stored response, so exactly one effect happens. A failure
 * rolls the claim back so the key can be retried with the same body.
 *
 * Precedence: the replay check runs before visibility, role, conflict and
 * validation checks, which happen inside the handler.
 */
/**
 * The missing-key answer (step 9, validation) is decided inside the handler,
 * after visibility, role and conflict checks. Handlers call
 * `requireIdempotencyKey` just before their effect.
 */
export function requireIdempotencyKey(rc: RouteContext): string {
  const key = rc.idempotencyKey ?? '';
  if (key.length < 1 || key.length > 100) {
    throw ERRORS.validation({ idempotency_key: 'Send an Idempotency-Key header.' });
  }
  return key;
}

export async function withIdempotency(
  rc: RouteContext,
  routeKey: string,
  handler: (tx: Tx) => Promise<IdemResult>,
): Promise<IdemResult> {
  const key = rc.idempotencyKey ?? '';
  const keyValid = key.length >= 1 && key.length <= 100;
  if (!keyValid) {
    // The handler decides the answer; without a key the effect never runs.
    return rc.ctx.db.withTx(handler);
  }
  const hash = bodyHash({ path: rc.url.pathname, body: rc.body ?? null });
  return rc.ctx.db.withTx(async (tx) => {
    await tx.query('SET LOCAL lock_timeout = 30000');
    const claim = await claimIdempotency(tx, rc.viewer.id, routeKey, key, hash);
    if (!claim.claimed && claim.storedResponse) {
      return {
        status: claim.storedResponse.status,
        body: JSON.parse(claim.storedResponse.body) as unknown,
      };
    }
    const result = await handler(tx);
    if (result.status >= 200 && result.status < 300) {
      await storeIdempotentResponse(
        tx,
        rc.viewer.id,
        routeKey,
        key,
        result.status,
        JSON.stringify(result.body ?? null),
      );
    } else {
      // A non-2xx answer is not stored; drop the claim so the key is reusable
      await tx.query(`DELETE FROM idempotency WHERE user_id = $1 AND route = $2 AND key = $3`, [
        rc.viewer.id,
        routeKey,
        key,
      ]);
    }
    return result;
  });
}
