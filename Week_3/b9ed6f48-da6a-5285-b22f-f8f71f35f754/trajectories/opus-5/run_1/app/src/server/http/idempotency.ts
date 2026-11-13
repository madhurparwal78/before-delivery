import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { pool, query, queryOne } from '../db/index.js';
import { AppError } from '../errors.js';
import { body } from './boundary.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const POLL_INTERVAL_MS = 75;
const POLL_TIMEOUT_MS = 60_000;

export interface Outcome {
  status: number;
  payload: unknown;
}

interface RecordRow {
  method: string;
  path: string;
  body_hash: string;
  state: string;
  status: number | null;
  response_body: unknown;
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, canonicalise(entry)]),
    );
  }
  return value;
}

function hashBody(request: Request): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(body(request)))).digest('hex');
}

function readKey(request: Request): string {
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new AppError('idempotency_key_required');
  return key;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function outcomeFrom(error: unknown): Outcome {
  if (error instanceof AppError) return { status: error.status, payload: error.body() };
  throw error;
}

/**
 * Carries one request through its key: a replay returns the stored answer, a duplicate in
 * flight waits for it, and the same key with a different body is refused.
 */
export async function withIdempotency(
  request: Request,
  response: Response,
  run: () => Promise<Outcome>,
): Promise<Outcome> {
  const key = readKey(request);
  const userId = request.user?.id ?? '';
  const bodyHash = hashBody(request);
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    const inserted = await query<{ key: string }>(
      `INSERT INTO idempotency_records (user_id, key, method, path, body_hash, state)
       VALUES ($1, $2, $3, $4, $5, 'in_flight')
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING key`,
      [userId, key, request.method, request.path, bodyHash],
    );
    if (inserted.length > 0) {
      let outcome: Outcome;
      try {
        outcome = await run();
      } catch (error) {
        outcome = outcomeFrom(error);
      }
      if (outcome.status >= 500) {
        await pool.query('DELETE FROM idempotency_records WHERE user_id = $1 AND key = $2', [userId, key]);
      } else {
        await pool.query(
          `UPDATE idempotency_records SET state = 'done', status = $3, response_body = $4::jsonb
           WHERE user_id = $1 AND key = $2`,
          [userId, key, outcome.status, JSON.stringify(outcome.payload ?? null)],
        );
      }
      return outcome;
    }

    const existing = await queryOne<RecordRow>(
      'SELECT method, path, body_hash, state, status, response_body FROM idempotency_records WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
    if (!existing) continue;
    if (existing.method !== request.method || existing.path !== request.path || existing.body_hash !== bodyHash) {
      throw new AppError('idempotency_conflict');
    }
    if (existing.state === 'done' && existing.status !== null) {
      response.setHeader('Idempotent-Replayed', 'true');
      return { status: existing.status, payload: existing.response_body };
    }
    if (Date.now() > deadline) throw new AppError('idempotency_conflict');
    await sleep(POLL_INTERVAL_MS);
  }
}
