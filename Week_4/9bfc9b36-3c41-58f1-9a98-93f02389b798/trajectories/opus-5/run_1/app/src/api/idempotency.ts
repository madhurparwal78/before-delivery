import { queryOne, transact } from '../db/pool';
import { AppError, invalid, refuse } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import type { Ctx, Reply } from './types';

/**
 * The one place that stores and replays an answer by its key. A replay returns
 * the same status and the byte-identical body, and writes nothing. The same key
 * on another target is refused.
 */

const PRINTABLE_ASCII = /^[\x20-\x7e]{1,100}$/;

export function requireIdempotencyKey(ctx: Ctx): string {
  const header = ctx.headers['idempotency-key'];
  if (typeof header !== 'string' || !PRINTABLE_ASCII.test(header)) {
    throw invalid({ 'Idempotency-Key': FIELD_COPY.required });
  }
  return header;
}

interface StoredAnswer {
  readonly target: string;
  readonly fingerprint: string;
  readonly status: number | null;
  readonly body: string | null;
}

/**
 * Runs the work once for a key, or replays the stored answer. The key is claimed
 * in its own transaction first, so two simultaneous calls with one key agree.
 */
export async function replayOrRun(
  ctx: Ctx,
  scope: string,
  target: string,
  fingerprint: string,
  work: () => Promise<Reply>,
): Promise<Reply> {
  const key = requireIdempotencyKey(ctx);

  const claimed = await transact(async (tx) => {
    const existing = await tx.one<StoredAnswer>(
      'SELECT target, fingerprint, status, body FROM idempotency WHERE scope = $1 AND key = $2 FOR UPDATE',
      [scope, key],
    );
    if (existing !== null) return existing;
    await tx.query(
      'INSERT INTO idempotency (scope, key, target, fingerprint) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [scope, key, target, fingerprint],
    );
    return tx.one<StoredAnswer>(
      'SELECT target, fingerprint, status, body FROM idempotency WHERE scope = $1 AND key = $2',
      [scope, key],
    );
  });

  if (claimed === null) throw refuse('idempotency_key_reused');
  if (claimed.target !== target || claimed.fingerprint !== fingerprint) {
    throw refuse('idempotency_key_reused');
  }
  if (claimed.status !== null && claimed.body !== null) {
    return { status: claimed.status, body: Buffer.from(claimed.body, 'utf8'), contentType: 'application/json; charset=utf-8' };
  }

  try {
    const answer = await work();
    const body = Buffer.from(JSON.stringify(answer.json), 'utf8');
    await store(scope, key, answer.status, body.toString('utf8'));
    return { status: answer.status, body, contentType: 'application/json; charset=utf-8' };
  } catch (cause) {
    // The first answer to a key is stored, whether it succeeded or was refused
    // on a state or member rule. Transport and authority refusals are not stored.
    if (cause instanceof AppError && (cause.status === 409 || cause.status === 422)) {
      await store(scope, key, cause.status, JSON.stringify(cause.body()));
    }
    throw cause;
  }
}

async function store(scope: string, key: string, status: number, body: string): Promise<void> {
  await transact(async (tx) => {
    await tx.query(
      `UPDATE idempotency SET status = $3, body = $4
        WHERE scope = $1 AND key = $2 AND status IS NULL`,
      [scope, key, status, body],
    );
  });
}

export async function storedAnswerFor(scope: string, key: string): Promise<StoredAnswer | null> {
  return queryOne<StoredAnswer>(
    'SELECT target, fingerprint, status, body FROM idempotency WHERE scope = $1 AND key = $2',
    [scope, key],
  );
}
