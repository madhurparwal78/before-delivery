import { query, queryOne } from '../db';

export type Reservation =
  | { readonly kind: 'owned' }
  | { readonly kind: 'replay'; readonly status: number; readonly body: string }
  | { readonly kind: 'conflict' };

interface Row {
  request_hash: string;
  status: number;
  body: string;
}

const PENDING = 0;
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 30_000;

/**
 * Reserves a key for this attempt, replays a stored response, or reports a reused key
 * carrying a different body. Records live in Postgres, so every app process shares them.
 */
export async function replayOrReserve(
  userId: string,
  route: string,
  key: string,
  requestHash: string,
): Promise<Reservation> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const inserted = await query<Row>(
      `insert into idempotency (user_id, route, key, request_hash, status, body, created_at)
       values ($1,$2,$3,$4,$5,'',now())
       on conflict (user_id, route, key) do nothing
       returning request_hash, status, body`,
      [userId, route, key, requestHash, PENDING],
    );
    if (inserted.length > 0) return { kind: 'owned' };

    const existing = await queryOne<Row>(
      'select request_hash, status, body from idempotency where user_id=$1 and route=$2 and key=$3',
      [userId, route, key],
    );
    if (existing === null) continue;
    if (existing.request_hash !== requestHash) return { kind: 'conflict' };
    if (existing.status !== PENDING) {
      return { kind: 'replay', status: existing.status, body: existing.body };
    }
    if (Date.now() > deadline) return { kind: 'conflict' };
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

export async function storeResponse(
  userId: string,
  route: string,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await query(
    `update idempotency set status=$4, body=$5, created_at=now()
     where user_id=$1 and route=$2 and key=$3`,
    [userId, route, key, status, body],
  );
}

/** Failed attempts are not stored, so the same key may be retried on any process. */
export async function releaseReservation(
  userId: string,
  route: string,
  key: string,
): Promise<void> {
  await query(
    'delete from idempotency where user_id=$1 and route=$2 and key=$3 and status=$4',
    [userId, route, key, PENDING],
  );
}
