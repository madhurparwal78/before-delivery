import type { Database } from '../db/pool';
import type { ApiResponse } from './context';
import { errors } from './errors';

/** Serialises work per key in arrival order, so duplicates queue behind the first request. */
export class KeyQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(() => undefined, () => undefined);
    this.chains.set(key, settled);
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return next;
  }
}

interface IdempotencyRow {
  readonly body_hash: string;
  readonly state: string;
  readonly status_code: number | null;
  readonly response: unknown;
}

async function readRecord(
  database: Database,
  accountId: string,
  key: string,
): Promise<IdempotencyRow | null> {
  const rows = await database.query<IdempotencyRow>(
    `select body_hash, state, status_code, response from idempotency_records
     where account_id = $1 and idem_key = $2`,
    [accountId, key],
  );
  return rows[0] ?? null;
}

/** Keys are scoped to the signed-in account and kept for 24 hours. */
export async function assertNoConflict(
  database: Database,
  accountId: string,
  key: string,
  bodyHash: string,
): Promise<void> {
  const record = await readRecord(database, accountId, key);
  if (record !== null && record.body_hash !== bodyHash) throw errors.idempotencyConflict();
}

export async function withIdempotency(
  database: Database,
  accountId: string,
  key: string,
  bodyHash: string,
  run: () => Promise<ApiResponse>,
): Promise<ApiResponse> {
  for (;;) {
    const record = await readRecord(database, accountId, key);
    if (record !== null && record.body_hash !== bodyHash) throw errors.idempotencyConflict();
    if (record !== null && record.state === 'done') {
      return {
        status: record.status_code ?? 201,
        json: record.response,
        headers: { 'Idempotent-Replay': 'true' },
      };
    }
    if (record !== null && record.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    const claimed = await database.query<{ idem_key: string }>(
      `insert into idempotency_records (account_id, idem_key, body_hash, state)
       values ($1, $2, $3, 'running')
       on conflict (account_id, idem_key) do nothing
       returning idem_key`,
      [accountId, key, bodyHash],
    );
    if (claimed.length === 0) continue;
    try {
      const response = await run();
      if (response.status === 201) {
        await database.query(
          `update idempotency_records set state = 'done', status_code = $3, response = $4
           where account_id = $1 and idem_key = $2`,
          [accountId, key, response.status, JSON.stringify(response.json ?? null)],
        );
      } else {
        await release(database, accountId, key);
      }
      return response;
    } catch (error) {
      await release(database, accountId, key);
      throw error;
    }
  }
}

async function release(database: Database, accountId: string, key: string): Promise<void> {
  await database.query(
    'delete from idempotency_records where account_id = $1 and idem_key = $2',
    [accountId, key],
  );
}

export async function purgeExpiredKeys(database: Database): Promise<void> {
  await database.query(
    "delete from idempotency_records where created_at < now() - interval '24 hours'",
  );
}
