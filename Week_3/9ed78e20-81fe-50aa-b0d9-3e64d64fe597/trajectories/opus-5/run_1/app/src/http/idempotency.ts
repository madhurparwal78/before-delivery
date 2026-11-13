import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { canonicalJson } from '../domain/audit.js';
import { errors } from './errors.js';
import type { Reply } from './reply.js';
import { textReply } from './reply.js';

const VISIBLE_ASCII = /^[\x21-\x7E]{1,255}$/;

export function readIdempotencyKey(header: string | undefined): string | null {
  if (header === undefined) return null;
  if (!VISIBLE_ASCII.test(header)) throw errors.invalidIdempotencyKey();
  return header;
}

export function fingerprintJson(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${canonicalJson(body)}`, 'utf8')
    .digest('hex');
}

export function fingerprintMultipart(
  method: string,
  path: string,
  fields: Readonly<Record<string, string>>,
  fileBytes: Buffer,
): string {
  const canonical = canonicalJson({
    ...fields,
    resume_sha256: createHash('sha256').update(fileBytes).digest('hex'),
  });
  return createHash('sha256').update(`${method}\n${path}\n${canonical}`, 'utf8').digest('hex');
}

export type IdempotencyClaim =
  | { readonly kind: 'fresh'; readonly finish: (reply: Reply) => Promise<void> }
  | { readonly kind: 'replay'; readonly reply: Reply };

/** Claims a key, replaying the first stored response when one exists. */
export async function claimIdempotencyKey(
  scope: string,
  key: string,
  fingerprint: string,
): Promise<IdempotencyClaim> {
  await query('DELETE FROM idempotency_keys WHERE scope = $1 AND idem_key = $2 AND expires_at <= now()', [
    scope,
    key,
  ]);
  const inserted = await query<{ idem_key: string }>(
    `INSERT INTO idempotency_keys (scope, idem_key, fingerprint, state, created_at, expires_at)
     VALUES ($1,$2,$3,'in_progress', now(), now() + ($4 || ' seconds')::interval)
     ON CONFLICT (scope, idem_key) DO NOTHING
     RETURNING idem_key`,
    [scope, key, fingerprint, String(config.idempotencyTtlSeconds)],
  );

  if (inserted.rows.length === 1) {
    return {
      kind: 'fresh',
      finish: async (reply: Reply): Promise<void> => {
        const storable =
          reply.status >= 200 &&
          reply.status < 500 &&
          reply.status !== 401 &&
          reply.status !== 429 &&
          reply.json !== undefined;
        if (storable) {
          await query(
            `UPDATE idempotency_keys SET state='done', status=$3, body=$4
              WHERE scope=$1 AND idem_key=$2`,
            [scope, key, reply.status, reply.body.toString('utf8')],
          );
          return;
        }
        await query('DELETE FROM idempotency_keys WHERE scope=$1 AND idem_key=$2', [scope, key]);
      },
    };
  }

  const existing = await query<{
    fingerprint: string;
    state: string;
    status: number | null;
    body: string | null;
  }>(
    'SELECT fingerprint, state, status, body FROM idempotency_keys WHERE scope=$1 AND idem_key=$2',
    [scope, key],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw errors.conflict(
      'idempotency_in_progress',
      'A request with this Idempotency-Key is still being processed.',
    );
  }
  if (row.fingerprint !== fingerprint) {
    throw errors.conflict(
      'idempotency_key_reused',
      'This Idempotency-Key was already used for a different request.',
    );
  }
  if (row.state !== 'done' || row.status === null) {
    throw errors.conflict(
      'idempotency_in_progress',
      'A request with this Idempotency-Key is still being processed.',
    );
  }
  return {
    kind: 'replay',
    reply: textReply(row.status, 'application/json; charset=utf-8', row.body ?? '{}', {
      'Idempotency-Replayed': 'true',
    }),
  };
}
