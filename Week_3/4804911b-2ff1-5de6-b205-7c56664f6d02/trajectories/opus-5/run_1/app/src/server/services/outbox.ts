import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';
import { publishJob } from './broker.js';

/** The published job bodies. Nothing else ever reaches the work queue. */
export type JobBody =
  | { jobId: string; kind: 'render'; number: string; version: number }
  | { jobId: string; kind: 'index'; skuCode: string }
  | { jobId: string; kind: 'send'; eventId: string };

export function renderJob(number: string, version: number): JobBody {
  return { jobId: `render-${number}-v${version}`, kind: 'render', number, version };
}

export function indexJob(skuCode: string): JobBody {
  return { jobId: `index-${skuCode}`, kind: 'index', skuCode };
}

export function sendJob(eventId: string): JobBody {
  return { jobId: eventId, kind: 'send', eventId };
}

/** Writes work in the same transaction as the state change it belongs to. */
export async function enqueue(client: PoolClient, body: JobBody): Promise<void> {
  await client.query('insert into outbox (job_id, kind, body) values ($1, $2, $3)', [
    body.jobId,
    body.kind,
    JSON.stringify(body),
  ]);
}

export async function enqueueIndex(client: PoolClient, skuCodes: string[]): Promise<void> {
  for (const skuCode of new Set(skuCodes)) {
    await client.query(
      `insert into index_pending (sku_code, requested_at) values ($1, now())
       on conflict (sku_code) do update set requested_at = now()`,
      [skuCode],
    );
    await enqueue(client, indexJob(skuCode));
  }
}

let relayRunning = false;

/** Carries outbox rows to the durable work queue with confirmed publishes. */
export function startRelay(): void {
  setInterval(() => {
    if (relayRunning) return;
    relayRunning = true;
    void relayOnce().finally(() => {
      relayRunning = false;
    });
  }, 250).unref();
}

async function relayOnce(): Promise<void> {
  let rows: { id: number; body: JobBody }[];
  try {
    const result = await query<{ id: number; body: JobBody }>(
      'select id, body from outbox where published_at is null order by id limit 50',
    );
    rows = result.rows;
  } catch {
    return;
  }
  for (const row of rows) {
    const published = await publishJob(row.body);
    if (!published) return;
    try {
      await query('update outbox set published_at = now() where id = $1', [row.id]);
    } catch {
      return;
    }
  }
}

export async function searchBehind(): Promise<boolean> {
  const result = await query<{ count: number }>('select count(*)::bigint as count from index_pending');
  return (result.rows[0]?.count ?? 0) > 0;
}

export async function workQueuedRows(): Promise<number> {
  const result = await query<{ count: number }>(
    'select count(*)::bigint as count from outbox where published_at is null',
  );
  return result.rows[0]?.count ?? 0;
}
