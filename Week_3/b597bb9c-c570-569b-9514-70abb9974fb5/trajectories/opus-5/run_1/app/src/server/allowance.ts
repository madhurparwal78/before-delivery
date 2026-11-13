/**
 * The month's export minutes and the workspace's stored bytes, held in the
 * shared counter so parallel requests can never pass the limit.
 */
import { ApiError } from '../domain/api-error.js';
import { allowanceText } from '../domain/errors.js';
import { config } from './config.js';
import { query } from './db.js';
import { workspace } from './repo/people.js';
import {
  CacheKeys,
  EXPORT_MINUTES_TTL_SECONDS,
  giveBackToCounter,
  readCounter,
  takeFromCounter,
  valkey,
} from './services/cache.js';
import type { AllowanceRecord } from '../shared/types.js';

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function resetsAt(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return next.toISOString();
}

/** If a month's counter is missing, it is rebuilt from Postgres. */
async function ensureMinutesCounter(workspaceId: string, month: string): Promise<string> {
  const key = CacheKeys.exportMinutes(workspaceId, month);
  const held = await readCounter(key);
  if (held !== null) return key;
  const space = await workspace();
  const opening = space.opening_month === month ? space.opening_minutes : 0;
  const rows = await query<{ minutes: number }>(
    `select coalesce(sum(minutes), 0)::int as minutes from exports
     where state not in ('cancelled','failed') and to_char(created_at at time zone 'utc', 'YYYY-MM') = $1`,
    [month],
  );
  const used = opening + (rows[0]?.minutes ?? 0);
  await valkey.set(key, String(used), 'EX', EXPORT_MINUTES_TTL_SECONDS, 'NX');
  return key;
}

async function ensureStorageCounter(workspaceId: string): Promise<string> {
  const key = CacheKeys.storageBytes(workspaceId);
  const held = await readCounter(key);
  if (held !== null) return key;
  const space = await workspace();
  const rows = await query<{ bytes: number }>(`select coalesce(sum(bytes), 0)::bigint as bytes from media`);
  const used = Number(space.carried_storage_bytes) + Number(rows[0]?.bytes ?? 0);
  await valkey.set(key, String(used), 'NX');
  return key;
}

export async function allowance(): Promise<AllowanceRecord> {
  const space = await workspace();
  const month = currentMonth();
  const minutesKey = await ensureMinutesCounter(space.id, month);
  const storageKey = await ensureStorageCounter(space.id);
  const minutes = (await readCounter(minutesKey)) ?? 0;
  const bytes = (await readCounter(storageKey)) ?? 0;
  const record: AllowanceRecord = {
    workspace_id: space.id,
    month,
    export_minutes_used: minutes,
    export_minutes_allowance: config.exportMinuteAllowance,
    storage_bytes_used: bytes,
    storage_bytes_allowance: config.storageAllowanceBytes,
    resets_at: resetsAt(),
    text: '',
  };
  record.text = allowanceText(record);
  return record;
}

export function allowanceExceeded(record: AllowanceRecord): ApiError {
  return ApiError.of(
    'allowance_exceeded',
    {
      export_minutes_used: record.export_minutes_used,
      export_minutes_allowance: record.export_minutes_allowance,
      storage_bytes_used: record.storage_bytes_used,
      storage_bytes_allowance: record.storage_bytes_allowance,
    },
    { allowance: record },
  );
}

/** Take export minutes in one atomic step, or refuse with the allowance. */
export async function takeMinutes(amount: number): Promise<void> {
  const space = await workspace();
  const month = currentMonth();
  const key = await ensureMinutesCounter(space.id, month);
  const taken = await takeFromCounter(key, amount, config.exportMinuteAllowance);
  if (!taken.taken) throw allowanceExceeded(await allowance());
}

export async function giveBackMinutes(amount: number, month: string): Promise<void> {
  const space = await workspace();
  await giveBackToCounter(CacheKeys.exportMinutes(space.id, month), amount);
}

export async function takeBytes(amount: number): Promise<void> {
  const space = await workspace();
  const key = await ensureStorageCounter(space.id);
  const taken = await takeFromCounter(key, amount, config.storageAllowanceBytes);
  if (!taken.taken) throw allowanceExceeded(await allowance());
}

export async function giveBackBytes(amount: number): Promise<void> {
  const space = await workspace();
  await giveBackToCounter(CacheKeys.storageBytes(space.id), amount);
}

export async function rebuildCountersAtStart(): Promise<void> {
  const space = await workspace();
  await ensureMinutesCounter(space.id, currentMonth());
  await ensureStorageCounter(space.id);
}

