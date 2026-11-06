// The idempotent replay lookup (Business rules: "Idempotency").
import { pool } from './db.ts';
import { apiError, HttpError, validation } from './errors.ts';
import { errorReply, type Reply, type Request } from './http.ts';

const KEY = /^[\x21-\x7e]{1,100}$/;
const KEEP_HOURS = 48; // kept for at least 24 hours

/** The key, or null when none was sent; a malformed key answers 422 before anything else. */
export function idempotencyKey(req: Request): string | null {
  const raw = req.raw.headers['idempotency-key'];
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (!KEY.test(value)) throw validation({ idempotency_key: 'Use 1 to 100 visible characters.' });
  return value;
}

/** Parsed JSON with sorted keys, so key order and whitespace never matter; a missing `after_block_id` equals null. */
function canonical(body: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  const value = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? { after_block_id: null, ...(body as Record<string, unknown>) }
    : body;
  return JSON.stringify(sort(value) ?? null);
}

/**
 * Runs `work` once per (endpoint, key). Requests with the same key are serialised on an advisory
 * lock, so concurrent repeats wait for the first and then replay its stored response.
 */
export async function withIdempotency(req: Request, key: string, work: () => Promise<Reply>): Promise<Reply> {
  const endpoint = `${req.method} ${req.path}`;
  const request = canonical(req.body);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    try {
      const { rows } = await client.query<{ endpoint: string; request: string; status: number; response: string }>(
        `SELECT endpoint, request::text AS request, status, response FROM idempotency_records
          WHERE key = $1 AND created_at > now() - make_interval(hours => $2)`, [key, KEEP_HOURS]);
      const seen = rows[0];
      if (seen) {
        if (seen.endpoint !== endpoint || canonical(JSON.parse(seen.request)) !== request) throw apiError(409, 'idempotency_conflict');
        return { status: seen.status, rawJson: seen.response, headers: { 'Idempotent-Replay': 'true' } };
      }
      let reply: Reply;
      try {
        reply = await work();
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        reply = errorReply(error);
      }
      if (reply.status < 500) {
        await client.query(
          `INSERT INTO idempotency_records (endpoint, key, request, status, response, created_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (key) DO UPDATE SET endpoint = EXCLUDED.endpoint, request = EXCLUDED.request, status = EXCLUDED.status, response = EXCLUDED.response, created_at = now()`,
          [endpoint, key, request, reply.status, JSON.stringify(reply.body ?? null)]);
      }
      return reply;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    }
  } finally {
    client.release();
  }
}

export function sweepIdempotency(): void {
  setInterval(() => {
    pool.query('DELETE FROM idempotency_records WHERE created_at < now() - make_interval(hours => $1)', [KEEP_HOURS]).catch(() => undefined);
  }, 3_600_000).unref();
}
