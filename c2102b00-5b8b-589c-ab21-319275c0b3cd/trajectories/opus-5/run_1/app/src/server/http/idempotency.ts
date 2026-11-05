import { createHash } from 'node:crypto';
import { db, writeTx } from '../db.ts';
import { ApiError, conflict, validation } from './errors.ts';
import type { ApiResult, RequestContext } from './context.ts';
import { requireSession } from './context.ts';

/** Idempotent replay: the one place a repeated key is judged. */

const KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const TAKEOVER_MS = 60_000;

interface StoredRow {
  method: string;
  path: string;
  body_hash: string;
  state: string;
  status: number | null;
  response: string | null;
  started_at: number;
}

interface StoredPayload {
  body?: unknown;
  headers?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withIdempotency(
  ctx: RequestContext,
  mode: 'required' | 'optional',
  work: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const header = ctx.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || key === '') {
    if (mode === 'optional') return work();
    throw validation({ idempotency_key: 'Send an Idempotency-Key header.' });
  }
  if (!KEY_PATTERN.test(key)) {
    throw validation({ idempotency_key: 'Use 8 to 64 letters, digits or hyphens.' });
  }
  const personKey = requireSession(ctx).personKey;
  const path = ctx.url.pathname;
  const bodyHash = createHash('sha256').update(ctx.rawBody).digest('hex');

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const claim = writeTx<'run' | 'wait' | { replay: StoredRow }>(() => {
      const row = db
        .prepare('SELECT method, path, body_hash, state, status, response, started_at FROM idempotency WHERE person_key = ? AND key = ?')
        .get(personKey, key) as StoredRow | undefined;
      if (!row) {
        db.prepare(
          `INSERT INTO idempotency (person_key, key, method, path, body_hash, state, started_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?)`,
        ).run(personKey, key, ctx.method, path, bodyHash, Date.now());
        return 'run';
      }
      const sameRequest = row.method === ctx.method && row.path === path && row.body_hash === bodyHash;
      if (!sameRequest) return { replay: row };
      if (row.state === 'done') return { replay: row };
      if (Date.now() - row.started_at > TAKEOVER_MS) {
        db.prepare('UPDATE idempotency SET started_at = ? WHERE person_key = ? AND key = ?').run(
          Date.now(),
          personKey,
          key,
        );
        return 'run';
      }
      return 'wait';
    });

    if (claim === 'wait') {
      await sleep(50);
      continue;
    }
    if (claim === 'run') {
      return runStoring(personKey, key, work);
    }
    const row = claim.replay;
    const sameRequest = row.method === ctx.method && row.path === path && row.body_hash === bodyHash;
    if (!sameRequest) {
      throw conflict('idempotency_key_reused', 'That key was already used for a different request.');
    }
    const payload = JSON.parse(row.response ?? '{}') as StoredPayload;
    return {
      status: row.status ?? 200,
      body: payload.body,
      headers: { ...(payload.headers ?? {}), 'Idempotent-Replay': 'true' },
    };
  }
  throw new ApiError(503, 'database_busy', 'That request is still running; try again.');
}

async function runStoring(
  personKey: string,
  key: string,
  work: () => Promise<ApiResult>,
): Promise<ApiResult> {
  const store = (status: number, payload: StoredPayload): void => {
    writeTx(() => {
      if (status >= 500) {
        db.prepare('DELETE FROM idempotency WHERE person_key = ? AND key = ?').run(personKey, key);
        return;
      }
      db.prepare(
        "UPDATE idempotency SET state = 'done', status = ?, response = ? WHERE person_key = ? AND key = ?",
      ).run(status, JSON.stringify(payload), personKey, key);
    });
  };
  try {
    const result = await work();
    store(result.status, { body: result.body, headers: result.headers });
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      store(error.status, { body: error.body(), headers: error.headers });
    } else {
      writeTx(() => {
        db.prepare('DELETE FROM idempotency WHERE person_key = ? AND key = ?').run(personKey, key);
      });
    }
    throw error;
  }
}
