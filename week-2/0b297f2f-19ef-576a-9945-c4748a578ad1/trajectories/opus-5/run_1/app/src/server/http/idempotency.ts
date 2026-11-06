import { createHash } from 'node:crypto';
import { withClient } from '../db/pool';
import { errors } from './errors';

const keyPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function requestHash(method: string, path: string, body: Buffer): string {
  return createHash('sha256')
    .update(method)
    .update('\n')
    .update(path)
    .update('\n')
    .update(body)
    .digest('hex');
}

export interface StoredResponse {
  status: number;
  body: Buffer;
}

export async function findStoredResponse(
  staffId: string,
  route: string,
  key: string,
  hash: string,
): Promise<StoredResponse | null> {
  if (!keyPattern.test(key)) {
    throw errors.validationFailed({
      idempotencyKey: 'Use 1 to 64 letters, digits, hyphens or underscores.',
    });
  }
  const row = await withClient(
    async (client) =>
      (
        await client.query(
          `select request_hash, status, body from idempotency_records
           where staff_id = $1 and route = $2 and key = $3`,
          [staffId, route, key],
        )
      ).rows[0],
  );
  if (!row) return null;
  if (String(row['request_hash']) !== hash) {
    throw errors.conflict('idempotency_conflict', 'That idempotency key was used for another request.');
  }
  return { status: Number(row['status']), body: row['body'] as Buffer };
}

export async function storeResponse(
  staffId: string,
  route: string,
  key: string,
  hash: string,
  status: number,
  body: Buffer,
): Promise<void> {
  if (status < 200 || status >= 500) return;
  await withClient(async (client) => {
    await client.query(
      `insert into idempotency_records (staff_id, route, key, request_hash, status, body)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (staff_id, route, key) do nothing`,
      [staffId, route, key, hash, status, body],
    );
  });
}
