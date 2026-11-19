import { createHash } from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { ApiError, conflict } from '../http/errors.js';
import { type Reply } from '../http/router.js';

export const fingerprintOf = (method: string, path: string, parts: readonly (string | Buffer)[]): string => {
  const hash = createHash('sha256').update(method).update('\u0000').update(path);
  for (const part of parts) hash.update('\u0000').update(part);
  return hash.digest('hex');
};

const storedReply = (status: number, body: string): Reply => ({
  status,
  bytes: Buffer.from(body, 'utf8'),
  contentType: 'application/json; charset=utf-8',
});

/** A result is stored only for requests that ended with a 2xx, a 409 state conflict or a 429. */
const isStorable = (status: number): boolean =>
  (status >= 200 && status < 300) || status === 429 || status === 409;

/**
 * Runs an action under one Idempotency-Key for one member: replays a stored
 * answer byte for byte, refuses a different request, and refuses duplicates in flight.
 */
export const withIdempotency = async (
  memberId: string,
  key: string | null,
  fingerprint: string,
  run: () => Promise<Reply>,
): Promise<Reply> => {
  if (key === null) return run();

  const claimed = await query<{ key: string }>(
    `insert into idempotency_records (member_id, key, fingerprint) values ($1, $2, $3)
     on conflict (member_id, key) do nothing returning key`,
    [memberId, key, fingerprint],
  );
  if (claimed.length === 0) {
    const existing = await queryOne<{ fingerprint: string; status: number | null; body: string | null; done: boolean }>(
      'select fingerprint, status, body, done from idempotency_records where member_id = $1 and key = $2',
      [memberId, key],
    );
    if (existing === null) return run();
    if (!existing.done) throw conflict('idempotency_in_progress', 'That request is still being processed.');
    if (existing.fingerprint !== fingerprint)
      throw conflict('idempotency_conflict', 'That idempotency key was used for a different request.');
    return storedReply(existing.status ?? 200, existing.body ?? '');
  }

  const discard = async (): Promise<void> => {
    await query('delete from idempotency_records where member_id = $1 and key = $2', [memberId, key]);
  };
  const keep = async (status: number, body: string): Promise<void> => {
    await query(
      'update idempotency_records set status = $3, body = $4, done = true where member_id = $1 and key = $2',
      [memberId, key, status, body],
    );
  };

  try {
    const reply = await run();
    if (isStorable(reply.status)) await keep(reply.status, JSON.stringify(reply.json));
    else await discard();
    return reply;
  } catch (error) {
    if (error instanceof ApiError && isStorable(error.status)) await keep(error.status, JSON.stringify(error.body()));
    else await discard();
    throw error;
  }
};
