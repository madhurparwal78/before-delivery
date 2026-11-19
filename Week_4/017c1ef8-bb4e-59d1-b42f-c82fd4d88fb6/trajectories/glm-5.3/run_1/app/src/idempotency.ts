import { Request, Response } from 'express';
import { ApiError, errors } from './errors.js';
import { query } from './db.js';
import { businessMs } from './clock.js';

type Stored = { status: number; body: unknown; body_hash: string; created_at: Date };

const hash = async (text: string): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
};

/**
 * Idempotent creates: a repeat within 24 hours of business-clock time returns the stored
 * response without a second record. A reused key with a different body is rejected.
 */
export const withIdempotency = async <T>(
  req: Request,
  res: Response,
  route: string,
  create: () => Promise<{ status: number; body: T }>,
): Promise<void> => {
  const key = req.headers['idempotency-key'];
  const memberId = req.auth?.memberId;
  if (typeof key !== 'string' || key === '' || !memberId) {
    const result = await create();
    res.status(result.status).json(result.body);
    return;
  }
  const bodyText = (req.rawBody ?? Buffer.alloc(0)).toString('utf8');
  const bodyHash = await hash(bodyText);
  const existing = await query<Stored>(
    `SELECT status, body, body_hash, created_at FROM idempotency_keys
     WHERE member_id = $1 AND route = $2 AND key = $3`,
    [memberId, route, key],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.body_hash !== bodyHash) throw errors.idempotencyKeyReused();
    if (businessMs() - new Date(row.created_at).getTime() > 24 * 3600 * 1000) {
      await query('DELETE FROM idempotency_keys WHERE member_id = $1 AND route = $2 AND key = $3',
        [memberId, route, key]);
    } else {
      res.status(row.status).json(row.body);
      return;
    }
  }
  const result = await create();
  if (result.status < 400) {
    await query(
      `INSERT INTO idempotency_keys (member_id, route, key, status, body, body_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [memberId, route, key, result.status, JSON.stringify(result.body), bodyHash, new Date(businessMs())],
    );
  }
  res.status(result.status).json(result.body);
};

export const ApiErrorClass = ApiError;
