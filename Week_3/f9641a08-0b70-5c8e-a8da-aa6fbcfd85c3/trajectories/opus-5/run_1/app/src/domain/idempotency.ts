import { createHash } from 'node:crypto';
import { db } from '../db/pool';
import { AppError, idempotencyMismatch } from '../errors';

export type StoredResponse = { status: number; payload: unknown; replayed: boolean };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export async function runIdempotent(
  key: string | null,
  scope: string,
  routeName: string,
  requestBody: unknown,
  run: () => Promise<{ status: number; payload: unknown }>
): Promise<StoredResponse> {
  if (key === null) {
    const result = await run();
    return { ...result, replayed: false };
  }
  const requestHash = hashRequest(requestBody);
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    const inserted = await db.one<{ id: string }>(
      `INSERT INTO request_keys (key, scope, route, request_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key, scope, route) DO NOTHING RETURNING id`,
      [key, scope, routeName, requestHash]
    );
    if (inserted !== null) {
      try {
        const result = await run();
        await db.query(
          'UPDATE request_keys SET completed = true, status = $2, response = $3::jsonb WHERE id = $1',
          [inserted.id, result.status, JSON.stringify(result.payload)]
        );
        return { ...result, replayed: false };
      } catch (error) {
        await db.query('DELETE FROM request_keys WHERE id = $1', [inserted.id]);
        throw error;
      }
    }

    const existing = await db.one<{
      id: string;
      request_hash: string;
      completed: boolean;
      status: number | null;
      response: unknown;
    }>('SELECT id, request_hash, completed, status, response FROM request_keys WHERE key = $1 AND scope = $2 AND route = $3', [
      key,
      scope,
      routeName
    ]);
    if (existing === null) continue;
    if (existing.request_hash !== requestHash) throw idempotencyMismatch();
    if (existing.completed && existing.status !== null) {
      return { status: existing.status, payload: existing.response, replayed: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new AppError(409, 'duplicate_request', "There's already an open request for this item.");
}
