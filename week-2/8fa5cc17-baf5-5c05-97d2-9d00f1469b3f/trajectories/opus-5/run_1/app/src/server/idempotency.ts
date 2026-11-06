import { query, queryOne } from './db/pool';

export type IdempotentOutcome =
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'conflict' }
  | { kind: 'proceed' };

const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 5000;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.map(([key, inner]) => [key, sortKeys(inner)]);
  }
  return value;
}

/** The idempotent replay lookup, answered before any resource, state or date check. */
export async function beginIdempotent(
  key: string,
  endpoint: string,
  body: unknown,
): Promise<IdempotentOutcome> {
  const inserted = await query<{ key: string }>(
    `insert into idempotency_record (key, endpoint, request_body)
     values ($1, $2, $3)
     on conflict (key, endpoint) do nothing
     returning key`,
    [key, endpoint, JSON.stringify(body)],
  );
  if (inserted.length === 1) {
    const other = await queryOne<{ endpoint: string }>(
      'select endpoint from idempotency_record where key = $1 and endpoint <> $2 limit 1',
      [key, endpoint],
    );
    if (other !== null) {
      await query('delete from idempotency_record where key = $1 and endpoint = $2 and status is null', [
        key,
        endpoint,
      ]);
      return { kind: 'conflict' };
    }
    return { kind: 'proceed' };
  }
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const record = await queryOne<{
      endpoint: string;
      request_body: unknown;
      status: number | null;
      response_body: unknown;
    }>('select endpoint, request_body, status, response_body from idempotency_record where key = $1 and endpoint = $2', [
      key,
      endpoint,
    ]);
    if (record === null) return { kind: 'conflict' };
    if (!sameJson(record.request_body, body)) return { kind: 'conflict' };
    if (record.status !== null) {
      return { kind: 'replay', status: record.status, body: record.response_body };
    }
    if (Date.now() > deadline) return { kind: 'conflict' };
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

export async function finishIdempotent(
  key: string,
  endpoint: string,
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    'update idempotency_record set status = $3, response_body = $4 where key = $1 and endpoint = $2',
    [key, endpoint, status, JSON.stringify(body)],
  );
}

export async function abandonIdempotent(key: string, endpoint: string): Promise<void> {
  await query('delete from idempotency_record where key = $1 and endpoint = $2 and status is null', [
    key,
    endpoint,
  ]);
}

export function startIdempotencyPruning(): NodeJS.Timeout {
  return setInterval(() => {
    void query(`delete from idempotency_record where created_at < now() - interval '48 hours'`).catch(
      () => undefined,
    );
  }, 3_600_000);
}
