import { pool, isoDate } from './db.js';
import type { Frequency } from '../shared/periods.js';

export interface ReturnRow {
  id: string;
  practice_id: string;
  client_id: string;
  client_name: string;
  registration_id: string;
  state_code: string;
  state_name: string;
  zone: string;
  frequency: Frequency;
  period: string;
  status: string;
  version: number;
  gross_sales: string | null;
  tax_due: string | null;
  edition_effective_date: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
  unextended_nominal_date: string;
  nominal_due_date: string;
  due_date: string;
  due_at: Date;
  extension_days_used: number | null;
  extension_due_date_before: string | null;
  extension_due_at_before: Date | null;
  extension_granted_at: Date | null;
  filed_at: Date | null;
  packet_state: 'none' | 'pending' | 'ready';
  packet_revisions: number;
  awaiting_approval: boolean;
  prepared_at: Date | null;
  amounts_set: boolean;
  changed_by: string;
}

const RETURN_SELECT = `
  select r.*, c.name as client_name, s.name as state_name, s.zone as zone
  from returns r
  join clients c on c.id = r.client_id
  join states s on s.practice_id = r.practice_id and s.code = r.state_code
`;

function rowToReturn(row: Record<string, unknown>): ReturnRow {
  return {
    id: row.id as string,
    practice_id: row.practice_id as string,
    client_id: row.client_id as string,
    client_name: row.client_name as string,
    registration_id: row.registration_id as string,
    state_code: row.state_code as string,
    state_name: row.state_name as string,
    zone: row.zone as string,
    frequency: row.frequency as Frequency,
    period: row.period as string,
    status: row.status as string,
    version: row.version as number,
    gross_sales: row.gross_sales === null ? null : String(row.gross_sales),
    tax_due: row.tax_due === null ? null : String(row.tax_due),
    edition_effective_date: isoDate(row.edition_effective_date as Date),
    due_day: row.due_day as number,
    carry: row.carry as 'next_business' | 'fixed',
    rate: String(row.rate),
    extension_days: row.extension_days as number,
    unextended_nominal_date: isoDate(row.unextended_nominal_date as Date),
    nominal_due_date: isoDate(row.nominal_due_date as Date),
    due_date: isoDate(row.due_date as Date),
    due_at: row.due_at as Date,
    extension_days_used: row.extension_days_used === null ? null : (row.extension_days_used as number),
    extension_due_date_before: row.extension_due_date_before === null ? null : isoDate(row.extension_due_date_before as Date),
    extension_due_at_before: row.extension_due_at_before === null ? null : (row.extension_due_at_before as Date),
    extension_granted_at: row.extension_granted_at === null ? null : (row.extension_granted_at as Date),
    filed_at: row.filed_at === null ? null : (row.filed_at as Date),
    packet_state: row.packet_state as 'none' | 'pending' | 'ready',
    packet_revisions: row.packet_revisions as number,
    awaiting_approval: row.awaiting_approval as boolean,
    prepared_at: row.prepared_at === null ? null : (row.prepared_at as Date),
    amounts_set: row.amounts_set as boolean,
    changed_by: row.changed_by as string,
  };
}

export async function getReturnById(id: string): Promise<ReturnRow | null> {
  const result = await pool.query(`${RETURN_SELECT} where r.id = $1`, [id]);
  return result.rows[0] === undefined ? null : rowToReturn(result.rows[0]);
}

export interface ReturnFilter {
  month?: string | undefined;
  year?: string | undefined;
  status?: string | undefined;
  state?: string | undefined;
  client?: string | undefined;
}

export async function listReturns(
  practiceId: string,
  filter: ReturnFilter,
  now: Date,
): Promise<ReturnRow[]> {
  const conditions: string[] = ['r.practice_id = $1'];
  const params: unknown[] = [practiceId];
  if (filter.month !== undefined) {
    conditions.push(`r.due_date >= $${params.length + 1}::date and r.due_date < ($${params.length + 1}::date + interval '1 month')`);
    params.push(`${filter.month}-01`);
  }
  if (filter.year !== undefined) {
    conditions.push(`r.due_date >= $${params.length + 1}::date and r.due_date < ($${params.length + 1}::date + interval '1 year')`);
    params.push(`${filter.year}-01-01`);
  }
  if (filter.state !== undefined) {
    conditions.push(`r.state_code = $${params.length + 1}`);
    params.push(filter.state);
  }
  if (filter.client !== undefined) {
    conditions.push(`r.client_id = $${params.length + 1}`);
    params.push(filter.client);
  }
  const result = await pool.query(
    `${RETURN_SELECT} where ${conditions.join(' and ')} order by r.due_at, c.name, r.state_code, r.id`,
    params,
  );
  const rows = result.rows.map(rowToReturn);
  if (filter.status === undefined) return rows;
  if (filter.status === 'overdue') return rows.filter((r) => isRowOverdue(r, now));
  return rows.filter((r) => r.status === filter.status);
}

export function isRowOverdue(row: ReturnRow, now: Date): boolean {
  if (row.status !== 'not_started' && row.status !== 'prepared' && row.status !== 'client_approved') return false;
  return now.getTime() > row.due_at.getTime();
}

export async function listClientReturns(clientId: string): Promise<ReturnRow[]> {
  const result = await pool.query(`${RETURN_SELECT} where r.client_id = $1 order by r.due_at, r.id`, [clientId]);
  return result.rows.map(rowToReturn);
}
