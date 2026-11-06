import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { SanitationEntry } from '../domain/types.js';

type Row = {
  id: string;
  kitchen_id: string;
  area: string;
  task: string;
  sanitizer_ppm: number | null;
  initials: string;
  notes: string;
  logged_at: Date;
  logged_by: string;
};

const columns = `id, kitchen_id, area, task, sanitizer_ppm, initials, notes, logged_at, logged_by`;

function toEntry(row: Row): SanitationEntry {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    area: row.area,
    task: row.task,
    sanitizerPpm: row.sanitizer_ppm,
    initials: row.initials,
    notes: row.notes,
    loggedAtMs: row.logged_at.getTime(),
    loggedBy: row.logged_by,
  };
}

export async function insertEntry(
  client: Queryable,
  entry: Omit<SanitationEntry, 'id'>,
): Promise<SanitationEntry> {
  const result = await client.query<Row>(
    `insert into sanitation_entries (id, kitchen_id, area, task, sanitizer_ppm, initials, notes,
                                     logged_at, logged_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${columns}`,
    [
      `san_${randomUUID()}`,
      entry.kitchenId,
      entry.area,
      entry.task,
      entry.sanitizerPpm,
      entry.initials,
      entry.notes,
      new Date(entry.loggedAtMs).toISOString(),
      entry.loggedBy,
    ],
  );
  return toEntry(result.rows[0]!);
}

export async function entriesBetween(
  client: Queryable,
  kitchenId: string,
  fromMs: number,
  toMs: number,
): Promise<SanitationEntry[]> {
  const result = await client.query<Row>(
    `select ${columns} from sanitation_entries
      where kitchen_id = $1 and logged_at >= $2 and logged_at < $3
      order by logged_at desc, seq desc`,
    [kitchenId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()],
  );
  return result.rows.map(toEntry);
}

export type SanitationReportRow = {
  month: string;
  status: 'stored' | 'queued';
  storedAtMs: number | null;
};

export async function listReports(
  client: Queryable,
  kitchenId: string,
): Promise<SanitationReportRow[]> {
  const result = await client.query<{ month: string; status: 'stored' | 'queued'; stored_at: Date | null }>(
    `select month, status, stored_at from sanitation_reports
      where kitchen_id = $1 order by month desc`,
    [kitchenId],
  );
  return result.rows.map((row) => ({
    month: row.month,
    status: row.status,
    storedAtMs: row.stored_at ? row.stored_at.getTime() : null,
  }));
}

export async function loadReport(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<SanitationReportRow | null> {
  const result = await client.query<{ month: string; status: 'stored' | 'queued'; stored_at: Date | null }>(
    `select month, status, stored_at from sanitation_reports
      where kitchen_id = $1 and month = $2`,
    [kitchenId, month],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    month: row.month,
    status: row.status,
    storedAtMs: row.stored_at ? row.stored_at.getTime() : null,
  };
}

export async function markReportQueued(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<void> {
  await client.query(
    `insert into sanitation_reports (kitchen_id, month, status) values ($1,$2,'queued')
     on conflict (kitchen_id, month) do update set status = 'queued'
      where sanitation_reports.status = 'queued'`,
    [kitchenId, month],
  );
}

export async function markReportStored(
  client: Queryable,
  kitchenId: string,
  month: string,
  storedAtMs: number,
): Promise<void> {
  await client.query(
    `insert into sanitation_reports (kitchen_id, month, status, stored_at)
     values ($1,$2,'stored',$3)
     on conflict (kitchen_id, month) do update set status = 'stored', stored_at = $3`,
    [kitchenId, month, new Date(storedAtMs).toISOString()],
  );
}

export async function queuedReportCount(
  client: Queryable,
  kitchenId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from sanitation_reports
      where kitchen_id = $1 and status = 'queued'`,
    [kitchenId],
  );
  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

export async function queuedReports(
  client: Queryable,
): Promise<Array<{ kitchenId: string; month: string }>> {
  const result = await client.query<{ kitchen_id: string; month: string }>(
    `select kitchen_id, month from sanitation_reports where status = 'queued'`,
  );
  return result.rows.map((row) => ({ kitchenId: row.kitchen_id, month: row.month }));
}
