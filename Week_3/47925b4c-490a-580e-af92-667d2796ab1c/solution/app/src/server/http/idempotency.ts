import { query, queryOne } from '../db/pool.js';
import { ProblemError, problem } from './problem.js';
import type { Reply } from './server.js';

const LEASE_SECONDS = 15;
const RENEW_MILLISECONDS = 5_000;
const WAIT_STEP_MILLISECONDS = 100;
const WAIT_LIMIT_MILLISECONDS = 30_000;

interface StoredRow {
  request_hash: string;
  state: string;
  status: number | null;
  response_body: { payload?: string; headers?: Record<string, string>; problem?: boolean } | null;
  lease_fresh: boolean;
}

interface ReplayOutcome {
  readonly replayed: boolean;
  readonly reply: Reply;
}

function storedReply(row: StoredRow): Reply {
  const stored = row.response_body;
  return {
    status: row.status ?? 200,
    raw: Buffer.from(stored?.payload ?? '', 'utf8'),
    headers: stored?.headers ?? {},
    contentType: stored?.problem === true ? 'application/problem+json' : 'application/json',
  };
}

async function readRow(method: string, path: string, key: string): Promise<StoredRow | null> {
  return queryOne<StoredRow & Record<string, unknown>>(
    `select request_hash, state, status, response_body, (lease_until > now()) as lease_fresh
     from idempotency_keys where method = $1 and path = $2 and key = $3`,
    [method, path, key],
  ) as Promise<StoredRow | null>;
}

/**
 * Gives a keyed action one effect and one stored outcome. A replay of the same
 * body returns the stored outcome; a different body is refused.
 */
export async function replayOrRun(
  method: string,
  path: string,
  key: string,
  fingerprint: string,
  run: () => Promise<Reply>,
): Promise<ReplayOutcome> {
  const claimed = await query(
    `insert into idempotency_keys (method, path, key, request_hash, state, lease_until)
     values ($1, $2, $3, $4, 'in_progress', now() + ($5 || ' seconds')::interval)
     on conflict (method, path, key) do update
       set request_hash = excluded.request_hash,
           state = 'in_progress',
           status = null,
           response_body = null,
           lease_until = excluded.lease_until
       where idempotency_keys.state = 'in_progress'
         and idempotency_keys.lease_until < now()
         and idempotency_keys.request_hash = excluded.request_hash
     returning key`,
    [method, path, key, fingerprint, String(LEASE_SECONDS)],
  );

  if (claimed.length === 0) {
    const waitedOut = Date.now() + WAIT_LIMIT_MILLISECONDS;
    for (;;) {
      const row = await readRow(method, path, key);
      if (row === null) break;
      if (row.request_hash !== fingerprint) throw problem('idempotency_key_reused');
      if (row.state === 'done') return { replayed: true, reply: storedReply(row) };
      if (!row.lease_fresh || Date.now() > waitedOut) break;
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MILLISECONDS));
    }
    return replayOrRun(method, path, key, fingerprint, run);
  }

  // Only a stopped process stops renewing, so its key frees itself after one lease.
  const renewing = setInterval(() => {
    void query(
      `update idempotency_keys set lease_until = now() + ($4 || ' seconds')::interval
       where method = $1 and path = $2 and key = $3 and state = 'in_progress'`,
      [method, path, key, String(LEASE_SECONDS)],
    ).catch(() => undefined);
  }, RENEW_MILLISECONDS);
  try {
    const reply = await run();
    await query(
      `update idempotency_keys set state = 'done', status = $4, response_body = $5::jsonb
       where method = $1 and path = $2 and key = $3`,
      [
        method,
        path,
        key,
        reply.status,
        JSON.stringify({ payload: JSON.stringify(reply.body), headers: reply.headers ?? {} }),
      ],
    );
    return { replayed: false, reply };
  } catch (error) {
    if (error instanceof ProblemError && error.status < 500) {
      await query(
        `update idempotency_keys set state = 'done', status = $4, response_body = $5::jsonb
         where method = $1 and path = $2 and key = $3`,
        [
          method,
          path,
          key,
          error.status,
          JSON.stringify({ payload: JSON.stringify(error.body), headers: { ...error.headers }, problem: true }),
        ],
      );
      throw error;
    }
    await query('delete from idempotency_keys where method = $1 and path = $2 and key = $3', [method, path, key]);
    throw error;
  } finally {
    clearInterval(renewing);
  }
}
