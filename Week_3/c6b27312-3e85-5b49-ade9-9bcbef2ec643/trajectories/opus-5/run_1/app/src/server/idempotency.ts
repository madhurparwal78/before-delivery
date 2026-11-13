import { CanonicalValue, canonicalJson } from '../shared/canonical';
import { config } from './config';
import { query } from './db';
import { ApiError, badIdempotencyKey, idempotencyInProgress, keyReused } from './errors';
import { Ctx } from './http';

const PRINTABLE_ASCII = /^[\x20-\x7e]{1,255}$/;

export type IdempotentAnswer = {
  status: number;
  body: unknown;
  location?: string;
  etag?: string;
};

type IdempotencyRow = {
  fingerprint: string;
  state: string;
  status: number | null;
  location: string | null;
  etag: string | null;
  body: string | null;
  created_at: Date;
};

export function callerOf(ctx: Ctx): string {
  return ctx.user ? ctx.user.id : `visitor:${ctx.visitorId}`;
}

/** Two requests are the same when their bodies give the same canonical JSON. */
export function fingerprintOf(body: unknown): string {
  return canonicalJson((body ?? null) as CanonicalValue);
}

function answerHeaders(answer: IdempotentAnswer): Record<string, string> {
  const headers: Record<string, string> = {};
  if (answer.location) headers.Location = answer.location;
  if (answer.etag) headers.ETag = answer.etag;
  return headers;
}

export function sendAnswer(ctx: Ctx, answer: IdempotentAnswer): void {
  const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
  ctx.res.writeHead(answer.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...answerHeaders(answer),
  });
  ctx.res.end(text);
}

/**
 * House rule H8: a completed key replays its stored answer, a key in progress gives 409
 * and a key reused with a different request gives 422.
 */
export async function withIdempotency(
  ctx: Ctx,
  run: () => Promise<IdempotentAnswer>,
): Promise<IdempotentAnswer> {
  const key = ctx.req.headers['idempotency-key'];
  if (key === undefined) return run();
  if (typeof key !== 'string' || !PRINTABLE_ASCII.test(key)) throw badIdempotencyKey();

  const caller = callerOf(ctx);
  const method = ctx.method;
  const path = ctx.url.pathname;
  const fingerprint = fingerprintOf(ctx.body);

  const claim = await query(
    `insert into idempotency_records (caller, method, path, key, fingerprint, state, created_at)
     values ($1,$2,$3,$4,$5,'in_progress', now())
     on conflict (caller, method, path, key) do nothing`,
    [caller, method, path, key, fingerprint],
  );

  if (claim.rowCount === 0) {
    const existing = await query<IdempotencyRow>(
      'select * from idempotency_records where caller = $1 and method = $2 and path = $3 and key = $4',
      [caller, method, path, key],
    );
    const record = existing.rows[0];
    if (record) {
      const age = (Date.now() - record.created_at.getTime()) / 1000;
      if (record.fingerprint !== fingerprint) throw keyReused();
      if (record.state === 'completed' && age < config.idempotencyTtlSeconds) {
        return {
          status: record.status ?? 200,
          body: record.body ?? '',
          location: record.location ?? undefined,
          etag: record.etag ?? undefined,
        };
      }
      if (record.state === 'in_progress') throw idempotencyInProgress();
      await query(
        `update idempotency_records set fingerprint = $5, state = 'in_progress', status = null,
           location = null, etag = null, body = null, created_at = now()
         where caller = $1 and method = $2 and path = $3 and key = $4`,
        [caller, method, path, key, fingerprint],
      );
    }
  }

  try {
    const answer = await run();
    if (answer.status >= 200 && answer.status < 300) {
      await query(
        `update idempotency_records set state = 'completed', status = $5, location = $6, etag = $7, body = $8
         where caller = $1 and method = $2 and path = $3 and key = $4`,
        [
          caller,
          method,
          path,
          key,
          answer.status,
          answer.location ?? null,
          answer.etag ?? null,
          typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body),
        ],
      );
    } else {
      await releaseKey(caller, method, path, key);
    }
    return answer;
  } catch (error) {
    await releaseKey(caller, method, path, key);
    throw error;
  }
}

async function releaseKey(caller: string, method: string, path: string, key: string): Promise<void> {
  await query(
    'delete from idempotency_records where caller = $1 and method = $2 and path = $3 and key = $4',
    [caller, method, path, key],
  );
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
