import type { Queryable } from '../db.js';
import { withTransaction } from '../db.js';
import { ApiError } from './errors.js';
import type { Reply } from './route.js';

export type IdempotencyScope = {
  accountId: number;
  method: string;
  path: string;
  key: string;
  body: Record<string, unknown>;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export class ReplayStored extends Error {
  constructor(readonly scope: IdempotencyScope) {
    super('replay stored response');
    this.name = 'ReplayStored';
  }
}

export class DeferredFailure extends Error {
  constructor(
    readonly scope: IdempotencyScope,
    readonly failure: ApiError
  ) {
    super('store failure response');
    this.name = 'DeferredFailure';
  }
}

type StoredRow = { request_body: unknown; status: number; response_body: unknown };

export async function lookupStored(
  client: Queryable,
  scope: IdempotencyScope
): Promise<Reply | null> {
  const { rows } = await client.query<StoredRow>(
    `SELECT request_body, status, response_body FROM idempotency_records
      WHERE account_id = $1 AND method = $2 AND path = $3 AND key = $4`,
    [scope.accountId, scope.method, scope.path, scope.key]
  );
  const row = rows[0];
  if (!row) return null;
  if (canonical(row.request_body) !== canonical(scope.body)) {
    throw new ApiError('idempotency_key_reused');
  }
  return {
    status: row.status,
    body: row.response_body,
    headers: { 'Idempotent-Replayed': 'true' }
  };
}

export async function storeResponse(
  client: Queryable,
  scope: IdempotencyScope,
  reply: Reply,
  at: Date
): Promise<void> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO idempotency_records
       (account_id, method, path, key, request_body, status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (account_id, method, path, key) DO NOTHING
     RETURNING id`,
    [
      scope.accountId,
      scope.method,
      scope.path,
      scope.key,
      JSON.stringify(scope.body),
      reply.status,
      JSON.stringify(reply.body ?? null),
      at.toISOString()
    ]
  );
  if (rows.length === 0) throw new ReplayStored(scope);
}

export async function storeFailure(
  scope: IdempotencyScope,
  error: ApiError,
  body: unknown,
  at: Date
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO idempotency_records
         (account_id, method, path, key, request_body, status, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_id, method, path, key) DO NOTHING`,
      [
        scope.accountId,
        scope.method,
        scope.path,
        scope.key,
        JSON.stringify(scope.body),
        error.status,
        JSON.stringify(body),
        at.toISOString()
      ]
    );
  });
}
