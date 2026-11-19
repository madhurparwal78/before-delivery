/**
 * Pending index updates live in Postgres. A unit is `syncing` while any of its
 * updates is unconfirmed, and an update is confirmed only once Meilisearch
 * reports its task succeeded.
 */

import type { PoolClient } from 'pg';
import { pool, query, type Db } from '../db';
import { now } from '../clock';
import { areaSqft, pricePerM2, pricePerSqft } from '../../shared/derived';
import { deleteDocuments, pushDocuments, taskState, type UnitDocument } from './client';

export type IndexOperation = 'upsert' | 'delete';

const PUSH_INTERVAL_MS = 2000;

export async function queueIndexUpdate(db: Db, unitCode: string, operation: IndexOperation): Promise<void> {
  await query(
    db,
    'insert into pending_index_updates (unit_code, operation, queued_at) values ($1, $2, $3)',
    [unitCode, operation, now()],
  );
}

export async function unconfirmedCodes(db: Db, codes: readonly string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set();
  const rows = await query<{ unit_code: string }>(
    db,
    'select distinct unit_code from pending_index_updates where not confirmed and unit_code = any($1::text[])',
    [codes as string[]],
  );
  return new Set(rows.map((row) => row.unit_code));
}

interface UnitDocumentRow {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  area_m2: number;
  bearing: number;
  facing: string;
  view_tag: string;
  price: string;
  price_version: number;
  status: string;
  view_photographed: boolean;
}

export function documentFromRow(row: UnitDocumentRow): UnitDocument {
  const price = Number(row.price);
  return {
    code: row.code,
    floor: row.floor,
    stack: row.stack,
    band: row.band,
    bedrooms: row.bedrooms,
    areaM2: row.area_m2,
    areaSqft: areaSqft(row.area_m2),
    bearing: row.bearing,
    facing: row.facing,
    viewTag: row.view_tag,
    price,
    pricePerM2: pricePerM2(price, row.area_m2),
    pricePerSqft: pricePerSqft(price, row.area_m2),
    priceVersion: row.price_version,
    status: row.status,
    viewPhotographed: row.view_photographed,
  };
}

interface PendingRow {
  id: string;
  unit_code: string;
  operation: IndexOperation;
}

/** Pushes every queued update that has not been handed to the index yet. */
async function pushQueued(client: PoolClient): Promise<void> {
  const pending = await query<PendingRow>(
    client,
    `select id, unit_code, operation from pending_index_updates
      where not confirmed and task_uid is null order by id limit 500`,
  );
  if (pending.length === 0) return;

  const latestByUnit = new Map<string, IndexOperation>();
  for (const row of pending) latestByUnit.set(row.unit_code, row.operation);
  const upsertCodes = [...latestByUnit.entries()].filter(([, op]) => op === 'upsert').map(([code]) => code);
  const deleteCodes = [...latestByUnit.entries()].filter(([, op]) => op === 'delete').map(([code]) => code);

  const taskUids: number[] = [];
  if (upsertCodes.length > 0) {
    const rows = await query<UnitDocumentRow>(
      client,
      `select code, floor, stack, band, bedrooms, area_m2, bearing, facing, view_tag,
              price::text as price, price_version, status, view_photographed
         from units where code = any($1::text[]) and status in ('available','held','reserved')`,
      [upsertCodes],
    );
    const documents = rows.map(documentFromRow);
    if (documents.length > 0) taskUids.push(await pushDocuments(documents));
    const missing = upsertCodes.filter((code) => !rows.some((row) => row.code === code));
    if (missing.length > 0) taskUids.push(await deleteDocuments(missing));
  }
  if (deleteCodes.length > 0) taskUids.push(await deleteDocuments(deleteCodes));
  if (taskUids.length === 0) return;

  await query(client, 'update pending_index_updates set task_uid = $1 where id = any($2::bigint[])', [
    Math.max(...taskUids),
    pending.map((row) => row.id),
  ]);
}

/** Confirms or re-queues updates the index has already been told about. */
async function confirmPushed(client: PoolClient): Promise<void> {
  const rows = await query<{ task_uid: string }>(
    client,
    'select distinct task_uid from pending_index_updates where not confirmed and task_uid is not null',
  );
  for (const row of rows) {
    const uid = Number(row.task_uid);
    const state = await taskState(uid);
    if (state === 'succeeded') {
      await query(client, 'update pending_index_updates set confirmed = true where task_uid = $1', [uid]);
    } else if (state === 'failed') {
      await query(client, 'update pending_index_updates set task_uid = null where task_uid = $1', [uid]);
    }
  }
  await query(client, 'delete from pending_index_updates where confirmed and queued_at < $1', [
    new Date(now().getTime() - 60_000),
  ]);
}

export async function flushPendingUpdates(): Promise<void> {
  const client = await pool.connect();
  try {
    await pushQueued(client);
    await confirmPushed(client);
  } finally {
    client.release();
  }
}

/** Waits up to `timeoutMs` for the given units to have no unconfirmed updates. */
export async function waitForIndexConfirmation(codes: readonly string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await flushPendingUpdates();
    } catch {
      return;
    }
    const outstanding = await unconfirmedCodes(pool, codes);
    if (outstanding.size === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function startIndexWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      await flushPendingUpdates();
    } catch {
      // Meilisearch is unreachable: the updates stay queued and are retried.
    }
    setTimeout(tick, PUSH_INTERVAL_MS);
  };
  setTimeout(tick, 200);
}
