/** Comparing idempotent requests and replaying their stored responses. */
import { db } from '../db/pool.js';
import { AppError, errors } from './errors.js';
import type { SignedContext } from './context.js';
import { storedJson, type Result } from './respond.js';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

type StoredRow = {
  path: string;
  body: unknown;
  status: number | null;
  response: string | null;
  done: boolean;
};

/**
 * Runs the work once per key and person. Repeats with the same parsed body
 * return the stored response; a key reused with a different request is refused.
 */
export async function withIdempotency(
  context: SignedContext,
  work: () => Promise<Result>,
): Promise<Result> {
  const key = context.idempotencyKey!;
  const bodyText = canonical(context.json);
  const claim = await db().query(
    `insert into idempotency_records (person_id, key, path, body)
     values ($1,$2,$3,$4::jsonb) on conflict (person_id, key) do nothing`,
    [context.person.id, key, context.path, bodyText],
  );

  if ((claim.rowCount ?? 0) === 0) {
    return replay(context, key, bodyText);
  }

  try {
    const result = await work();
    await store(context, key, result);
    return result;
  } catch (error) {
    if (error instanceof AppError) {
      await store(context, key, { kind: 'json', status: error.status, body: error.body() });
      throw error;
    }
    await db().query(`delete from idempotency_records where person_id = $1 and key = $2`, [
      context.person.id,
      key,
    ]);
    throw error;
  }
}

async function store(context: SignedContext, key: string, result: Result): Promise<void> {
  if (result.kind !== 'json') return;
  await db().query(
    `update idempotency_records set status = $3, response = $4, done = true
      where person_id = $1 and key = $2`,
    [context.person.id, key, result.status, JSON.stringify(result.body)],
  );
}

async function replay(
  context: SignedContext,
  key: string,
  bodyText: string,
): Promise<Result> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const found = await db().query<StoredRow>(
      `select path, body, status, response, done from idempotency_records
        where person_id = $1 and key = $2`,
      [context.person.id, key],
    );
    const row = found.rows[0];
    if (!row) throw errors.idempotencyKeyReused();
    if (row.path !== context.path || canonical(row.body) !== bodyText) {
      throw errors.idempotencyKeyReused();
    }
    if (row.done && row.status !== null && row.response !== null) {
      return storedJson(row.status, row.response);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw errors.internal();
}

export function validKeyFormat(key: string | null): boolean {
  return key !== null && /^[A-Za-z0-9_-]{8,128}$/.test(key);
}
