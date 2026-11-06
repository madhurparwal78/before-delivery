import { createHash } from 'node:crypto';
import { config } from './config.js';
import { now } from './clock.js';
import { query, queryOne, withTransaction } from './db.js';
import { ApiError, conflict } from './errors.js';
import { newId } from './util.js';
import type { Caller } from './auth.js';

/**
 * Idempotency for visit close, invoice payments, payment capture, void and refund, and
 * import. A key is scoped to the caller and the route, claimed atomically before any
 * call to Kill Bill or any queued email, and kept with its response so a replay creates
 * nothing new.
 */
export interface StoredResponse {
  status: number;
  body: unknown;
}

function actorKey(caller: Caller): string {
  return caller.tokenId === null ? `user:${caller.userId}` : `token:${caller.tokenId}`;
}

function bodyHash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type Claim =
  | { kind: 'owned' }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

async function claim(
  caller: Caller,
  routeKey: string,
  idemKey: string,
  hash: string,
): Promise<Claim> {
  const instant = now();
  const leaseExpiresAt = new Date(instant.getTime() + config.idempotencyLeaseSeconds * 1000);
  return await withTransaction(async (db) => {
    const inserted = await query<{ id: string }>(
      db,
      `INSERT INTO idempotency_claims (id, actor_key, route_key, idem_key, body_hash,
                                       lease_expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (actor_key, route_key, idem_key) DO NOTHING
       RETURNING id`,
      [newId(), actorKey(caller), routeKey, idemKey, hash, leaseExpiresAt, instant],
    );
    if (inserted.length > 0) return { kind: 'owned' };

    const existing = await queryOne<{
      body_hash: string;
      lease_expires_at: Date;
      response_status: number | null;
      response_body: unknown;
    }>(
      db,
      `SELECT body_hash, lease_expires_at, response_status, response_body
       FROM idempotency_claims
       WHERE actor_key = $1 AND route_key = $2 AND idem_key = $3 FOR UPDATE`,
      [actorKey(caller), routeKey, idemKey],
    );
    if (existing === null) return { kind: 'owned' };

    // The same key with a different body is a conflict, in flight or not.
    if (existing.body_hash !== hash) return { kind: 'conflict' };
    if (existing.response_status !== null) {
      return {
        kind: 'replay',
        response: { status: existing.response_status, body: existing.response_body },
      };
    }
    if (existing.lease_expires_at.getTime() > instant.getTime()) return { kind: 'in_progress' };

    // The lease expired with no stored response: this request takes over.
    await query(
      db,
      `UPDATE idempotency_claims SET lease_expires_at = $4
       WHERE actor_key = $1 AND route_key = $2 AND idem_key = $3`,
      [actorKey(caller), routeKey, idemKey, leaseExpiresAt],
    );
    return { kind: 'owned' };
  });
}

async function storeResponse(
  caller: Caller,
  routeKey: string,
  idemKey: string,
  response: StoredResponse,
): Promise<void> {
  await withTransaction((db) =>
    query(
      db,
      `UPDATE idempotency_claims SET response_status = $4, response_body = $5::jsonb
       WHERE actor_key = $1 AND route_key = $2 AND idem_key = $3`,
      [actorKey(caller), routeKey, idemKey, response.status, JSON.stringify(response.body)],
    ),
  );
}

export async function releaseClaim(
  caller: Caller,
  routeKey: string,
  idemKey: string,
): Promise<void> {
  await withTransaction((db) =>
    query(
      db,
      `DELETE FROM idempotency_claims
       WHERE actor_key = $1 AND route_key = $2 AND idem_key = $3 AND response_status IS NULL`,
      [actorKey(caller), routeKey, idemKey],
    ),
  );
}

/**
 * Runs the work behind an idempotency key. Refusals are stored too, so a replay of a
 * declined or unavailable answer repeats it exactly.
 */
export async function withIdempotency(
  caller: Caller,
  routeKey: string,
  idemKey: string,
  body: Buffer | string,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const hash = bodyHash(body);
  const outcome = await claim(caller, routeKey, idemKey, hash);
  switch (outcome.kind) {
    case 'conflict':
      throw conflict('idempotency_conflict');
    case 'in_progress':
      throw conflict('idempotency_in_progress');
    case 'replay':
      return outcome.response;
    case 'owned':
      break;
  }

  try {
    const response = await run();
    await storeResponse(caller, routeKey, idemKey, response);
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status !== 500) {
      await storeResponse(caller, routeKey, idemKey, { status: error.status, body: error.body() });
      throw error;
    }
    // An internal failure leaves no stored response, so a retry takes over after the lease.
    await releaseClaim(caller, routeKey, idemKey);
    throw error;
  }
}
