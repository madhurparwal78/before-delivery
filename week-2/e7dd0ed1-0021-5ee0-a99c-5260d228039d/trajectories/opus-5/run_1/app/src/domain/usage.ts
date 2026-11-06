import type { PoolClient } from '../db';
import { query, row, rows } from '../db';
import { compactStamp, decimalDivide, isoSecond } from '../format';
import { nowSecond } from '../http/core';

export type UsageUnit = 'storage-gb-hours' | 'egress-gb' | 'request-units';

export function topOfHour(at: Date): Date {
  const copy = new Date(at.getTime());
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

export function nextHour(at: Date): Date {
  return new Date(topOfHour(at).getTime() + 3600000);
}

export function trackingId(slug: string, bucket: string, unit: UsageUnit, windowStart: Date): string {
  return `fs-${slug}-${bucket}-${unit}-${compactStamp(windowStart)}`;
}

async function lastSealAt(client: PoolClient): Promise<Date | null> {
  const found = await row<{ value: string }>(client, "select value from service_state where name = 'last_seal_at'", []);
  return found ? new Date(found.value) : null;
}

/** A window starts at the top of the UTC hour, or at an earlier manual seal inside the same hour. */
export async function windowStartFor(client: PoolClient, at: Date): Promise<Date> {
  const hourStart = topOfHour(at);
  const seal = await lastSealAt(client);
  if (seal && seal.getTime() > hourStart.getTime() && seal.getTime() <= at.getTime()) return seal;
  return hourStart;
}

async function accrue(client: PoolClient, slug: string, bucket: string, unit: UsageUnit, amount: number, at: Date): Promise<void> {
  const windowStart = await windowStartFor(client, at);
  await client.query(
    `insert into usage_rows (workspace_slug, bucket, unit, window_start, raw_count, billing_state, sealed)
     values ($1, $2, $3, $4, $5, 'open', false)
     on conflict (workspace_slug, bucket, unit, window_start)
     do update set raw_count = usage_rows.raw_count + $5`,
    [slug, bucket, unit, windowStart.toISOString(), amount],
  );
}

export async function recordRequestUnits(client: PoolClient, slug: string, bucket: string, count = 1): Promise<void> {
  if (count <= 0) return;
  await accrue(client, slug, bucket, 'request-units', count, nowSecond());
}

export async function recordEgressBytes(client: PoolClient, slug: string, bucket: string, bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await accrue(client, slug, bucket, 'egress-gb', bytes, nowSecond());
}

/** Every change to a bucket's stored bytes is logged at its acknowledgement second for the integral. */
export async function noteStoredBytes(
  client: PoolClient,
  bucket: string,
  slug: string,
  atSecond: Date,
  storedBytes: bigint,
): Promise<void> {
  await client.query(
    'insert into stored_bytes_log (bucket, workspace_slug, at_second, stored_bytes) values ($1, $2, $3, $4)',
    [bucket, slug, nowSecond(atSecond).toISOString(), storedBytes.toString()],
  );
}

export async function storageByteSeconds(client: PoolClient, bucket: string, from: Date, to: Date): Promise<bigint> {
  if (to.getTime() <= from.getTime()) return 0n;
  const before = await row<{ stored_bytes: string }>(
    client,
    'select stored_bytes from stored_bytes_log where bucket = $1 and at_second <= $2 order by at_second desc, id desc limit 1',
    [bucket, from.toISOString()],
  );
  const changes = await rows<{ at_second: string; stored_bytes: string }>(
    client,
    `select at_second, stored_bytes from stored_bytes_log
     where bucket = $1 and at_second > $2 and at_second < $3 order by at_second, id`,
    [bucket, from.toISOString(), to.toISOString()],
  );
  let total = 0n;
  let current = BigInt(before?.stored_bytes ?? '0');
  let cursor = from.getTime();
  for (const change of changes) {
    const changeAt = new Date(change.at_second).getTime();
    if (changeAt > cursor) {
      total += current * BigInt(Math.round((changeAt - cursor) / 1000));
      cursor = changeAt;
    }
    current = BigInt(change.stored_bytes);
  }
  if (to.getTime() > cursor) total += current * BigInt(Math.round((to.getTime() - cursor) / 1000));
  return total;
}

function amountFor(unit: UsageUnit, rawCount: bigint): string {
  if (unit === 'request-units') return decimalDivide(rawCount, 1n, 0);
  return decimalDivide(rawCount, 1000000000n, 9);
}

async function storageSealedThrough(client: PoolClient, bucket: string, createdAt: Date): Promise<Date> {
  const found = await row<{ value: string }>(client, 'select value from service_state where name = $1', [`storage_through:${bucket}`]);
  return found ? new Date(found.value) : topOfHour(createdAt);
}

async function setStorageSealedThrough(client: PoolClient, bucket: string, at: Date): Promise<void> {
  await client.query(
    `insert into service_state (name, value) values ($1, $2) on conflict (name) do update set value = $2`,
    [`storage_through:${bucket}`, at.toISOString()],
  );
}

async function insertSealedRow(
  client: PoolClient,
  slug: string,
  bucket: string,
  unit: UsageUnit,
  windowStart: Date,
  windowEnd: Date,
  amount: string,
): Promise<void> {
  if (amount === '0') return;
  await client.query(
    `insert into usage_rows (workspace_slug, bucket, unit, window_start, window_end, amount, tracking_id, billing_state, sealed)
     values ($1, $2, $3, $4, $5, $6, $7, 'queued', true)
     on conflict (workspace_slug, bucket, unit, window_start) do nothing`,
    [slug, bucket, unit, windowStart.toISOString(), windowEnd.toISOString(), amount, trackingId(slug, bucket, unit, windowStart)],
  );
}

/**
 * Seals usage windows. `manual` seals every open window at `at`; otherwise only windows whose
 * hour has ended are sealed. Sealing is idempotent: a sealed row is never rewritten.
 */
export async function sealWindows(client: PoolClient, at: Date, manual: boolean): Promise<number> {
  const now = nowSecond(at);
  const open = await rows<{ id: string; workspace_slug: string; bucket: string; unit: string; window_start: string; raw_count: string }>(
    client,
    `select id, workspace_slug, bucket, unit, window_start, raw_count::text as raw_count
     from usage_rows where not sealed order by window_start`,
  );
  let sealed = 0;
  for (const openRow of open) {
    const windowStart = new Date(openRow.window_start);
    const hourEnd = nextHour(windowStart);
    const windowEnd = manual && now.getTime() < hourEnd.getTime() ? now : hourEnd;
    if (windowEnd.getTime() > now.getTime()) continue;
    if (windowEnd.getTime() <= windowStart.getTime()) continue;
    const unit = openRow.unit as UsageUnit;
    const amount = amountFor(unit, BigInt(openRow.raw_count));
    if (amount === '0') {
      await client.query('delete from usage_rows where id = $1', [openRow.id]);
      continue;
    }
    await client.query(
      `update usage_rows set sealed = true, window_end = $2, amount = $3, tracking_id = $4, billing_state = 'queued'
       where id = $1`,
      [
        openRow.id,
        windowEnd.toISOString(),
        amount,
        trackingId(openRow.workspace_slug, openRow.bucket, unit, windowStart),
      ],
    );
    sealed += 1;
  }

  const buckets = await rows<{ name: string; workspace_slug: string; created_at: string }>(
    client,
    'select name, workspace_slug, created_at from buckets order by name',
  );
  for (const bucket of buckets) {
    let through = await storageSealedThrough(client, bucket.name, new Date(bucket.created_at));
    while (through.getTime() < now.getTime()) {
      const hourEnd = nextHour(through);
      const windowEnd = hourEnd.getTime() <= now.getTime() ? hourEnd : manual ? now : null;
      if (windowEnd === null) break;
      const byteSeconds = await storageByteSeconds(client, bucket.name, through, windowEnd);
      const amount = decimalDivide(byteSeconds, 3600000000000n, 9);
      await insertSealedRow(client, bucket.workspace_slug, bucket.name, 'storage-gb-hours', through, windowEnd, amount);
      if (amount !== '0') sealed += 1;
      through = windowEnd;
      await setStorageSealedThrough(client, bucket.name, through);
    }
  }

  if (manual) {
    await client.query(
      `insert into service_state (name, value) values ('last_seal_at', $1) on conflict (name) do update set value = $1`,
      [now.toISOString()],
    );
  }
  return sealed;
}

export interface UsageRowJson {
  window_start: string;
  window_end: string;
  bucket: string;
  unit: string;
  amount: string;
  tracking_id: string;
  billing_state: string;
}

export async function monthToDate(slug: string, period: string): Promise<{
  egressBytes: number;
  requestUnits: number;
  storageGbHours: string;
}> {
  const found = await query<{ unit: string; raw: string; amount: string }>(
    `select unit, coalesce(sum(raw_count), 0)::text as raw, coalesce(sum(amount), 0)::text as amount
     from usage_rows where workspace_slug = $1 and to_char(window_start, 'YYYY-MM') = $2 group by unit`,
    [slug, period],
  );
  let egress = 0;
  let requests = 0;
  let storage = '0';
  for (const item of found) {
    if (item.unit === 'egress-gb') egress = Number(item.raw);
    if (item.unit === 'request-units') requests = Number(item.raw);
    if (item.unit === 'storage-gb-hours') storage = trimDecimal(item.amount);
  }
  return { egressBytes: egress, requestUnits: requests, storageGbHours: storage };
}

export async function usageRowsPage(slug: string, period: string, cursor: number, limit: number): Promise<UsageRowJson[]> {
  const found = await query<{
    window_start: string;
    window_end: string | null;
    bucket: string;
    unit: string;
    amount: string | null;
    raw_count: string;
    tracking_id: string | null;
    billing_state: string;
  }>(
    `select window_start, window_end, bucket, unit, amount::text as amount, raw_count::text as raw_count, tracking_id, billing_state
     from usage_rows where workspace_slug = $1 and to_char(window_start, 'YYYY-MM') = $2
     order by window_start desc, bucket, unit offset $3 limit $4`,
    [slug, period, cursor, limit],
  );
  return found.map((item) => ({
    window_start: isoSecond(item.window_start),
    window_end: isoSecond(item.window_end ?? nextHour(new Date(item.window_start))),
    bucket: item.bucket,
    unit: item.unit,
    amount: item.amount !== null ? trimDecimal(item.amount) : amountFor(item.unit as UsageUnit, BigInt(item.raw_count)),
    tracking_id: item.tracking_id ?? trackingId(slug, item.bucket, item.unit as UsageUnit, new Date(item.window_start)),
    billing_state: item.billing_state,
  }));
}

export function trimDecimal(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

export async function usageRowsForPeriod(slug: string, period: string): Promise<UsageRowJson[]> {
  const found = await query<{
    window_start: string;
    window_end: string | null;
    bucket: string;
    unit: string;
    amount: string | null;
    raw_count: string;
    tracking_id: string | null;
    billing_state: string;
  }>(
    `select window_start, window_end, bucket, unit, amount::text as amount, raw_count::text as raw_count, tracking_id, billing_state
     from usage_rows where workspace_slug = $1 and to_char(window_start, 'YYYY-MM') = $2
     order by window_start, bucket, unit`,
    [slug, period],
  );
  return found.map((item) => ({
    window_start: isoSecond(item.window_start),
    window_end: isoSecond(item.window_end ?? nextHour(new Date(item.window_start))),
    bucket: item.bucket,
    unit: item.unit,
    amount: item.amount !== null ? trimDecimal(item.amount) : amountFor(item.unit as UsageUnit, BigInt(item.raw_count)),
    tracking_id: item.tracking_id ?? trackingId(slug, item.bucket, item.unit as UsageUnit, new Date(item.window_start)),
    billing_state: item.billing_state,
  }));
}

export async function billingSummary(slug: string, period: string): Promise<{
  state: 'in_sync' | 'pending' | 'delayed';
  unpostedRows: number;
  confirmedThrough: string | null;
}> {
  const status = await row0();
  const unposted = await query<{ count: string }>(
    `select count(*)::text as count from usage_rows
     where workspace_slug = $1 and sealed and billing_state <> 'posted'`,
    [slug],
  );
  const confirmed = await query<{ latest: string | null }>(
    `select max(window_end) as latest from usage_rows
     where workspace_slug = $1 and billing_state = 'posted' and to_char(window_start, 'YYYY-MM') = $2`,
    [slug, period],
  );
  const unpostedRows = Number(unposted[0]?.count ?? '0');
  const state = !status.reachable ? 'delayed' : unpostedRows > 0 ? 'pending' : 'in_sync';
  return { state, unpostedRows, confirmedThrough: confirmed[0]?.latest ? isoSecond(confirmed[0].latest) : null };
}

async function row0(): Promise<{ reachable: boolean; last_attempt_at: string | null; last_error: string | null }> {
  const found = await query<{ reachable: boolean; last_attempt_at: string | null; last_error: string | null }>(
    'select reachable, last_attempt_at, last_error from billing_status where id = 1',
  );
  return found[0] ?? { reachable: true, last_attempt_at: null, last_error: null };
}

export const billingStatusRow = row0;

export function currentPeriod(at: Date = new Date()): string {
  return isoSecond(at).slice(0, 7);
}
