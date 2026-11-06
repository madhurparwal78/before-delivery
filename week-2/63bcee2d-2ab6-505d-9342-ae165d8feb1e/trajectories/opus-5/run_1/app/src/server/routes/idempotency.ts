/**
 * Idempotent endpoints. A replay of the same key and body returns the original
 * response; the same key with a different body is refused.
 */

import { createHash } from 'node:crypto';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { firstRow, pool } from '../db/pool.js';
import type { Context, Reply } from '../http/context.js';
import { conflict, validation } from '../http/errors.js';
import type { Member } from '../http/session.js';

const KEY_PATTERN = /^[\x20-\x7e]{1,100}$/;

/** A stable hash of the body, compared as JSON and ignoring key order. */
function bodyHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([name, entry]) => [name, canonical(entry)]),
      );
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value) ?? null)).digest('hex');
}

export async function withIdempotency(
  context: Context,
  member: Member,
  run: () => Promise<Reply>,
): Promise<Reply> {
  const key = context.header('idempotency-key') ?? '';
  if (!KEY_PATTERN.test(key)) {
    throw validation({ idempotencyKey: fieldErrorCopy.missingRetryKey() });
  }
  const hash = bodyHash(await context.jsonForReplay());

  const stored = await firstRow<{ body_hash: string; status: number; response: unknown }>(
    pool,
    `SELECT body_hash, status, response FROM idempotency_records
      WHERE member_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'`,
    [member.id, key],
  );
  if (stored) {
    if (stored.body_hash !== hash) throw conflict('idempotency_key_reused');
    return { status: stored.status, json: stored.response };
  }

  const reply = await run();
  await pool.query(
    `INSERT INTO idempotency_records (member_id, key, body_hash, status, response)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (member_id, key) DO NOTHING`,
    [member.id, key, hash, reply.status, JSON.stringify(reply.json ?? null)],
  );
  return reply;
}
