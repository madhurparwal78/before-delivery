import type { HistoryEntry, Operation, Role, SetField, Voice } from '../../shared/types.js';
import { query } from '../db/pool.js';

export interface HistoryFilter {
  staffId?: string;
  type?: Operation['type'];
  fields?: SetField[];
  before?: number;
  limit: number;
}

interface HistoryRow {
  seq: string;
  op: Operation;
  type: Operation['type'];
  field: SetField | null;
  staff_id: string;
  staff_name: string;
  voice: number;
  measure: number;
  beat: number;
  summary: string;
  at: Date;
  author_id: string;
  author_name: string;
  author_role: Role;
}

export function encodeHistoryCursor(seq: number): string {
  return Buffer.from(`h${seq}`, 'utf8').toString('base64url');
}

export function decodeHistoryCursor(raw: string): number | null {
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    if (!text.startsWith('h')) return null;
    const value = Number(text.slice(1));
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export async function readHistory(
  scoreId: string,
  filter: HistoryFilter,
): Promise<{ entries: HistoryEntry[]; nextCursor: string | null }> {
  const conditions = ['o.score_id = $1'];
  const values: unknown[] = [scoreId];
  if (filter.before !== undefined) {
    values.push(filter.before);
    conditions.push(`o.seq < $${values.length}`);
  }
  if (filter.staffId !== undefined) {
    values.push(filter.staffId);
    conditions.push(`o.staff_id = $${values.length}`);
  }
  if (filter.type !== undefined) {
    values.push(filter.type);
    conditions.push(`o.type = $${values.length}`);
  }
  if (filter.fields !== undefined) {
    values.push(filter.fields);
    conditions.push(`o.field = any($${values.length}::text[])`);
  }
  values.push(filter.limit + 1);
  const rows = await query<HistoryRow>(
    `select o.seq, o.op, o.type, o.field, o.staff_id, s.name as staff_name, o.voice,
            o.measure, o.beat, o.summary, o.at,
            c.id as author_id, c.name as author_name, c.role as author_role
     from operations o
     join staves s on s.id = o.staff_id
     join collaborators c on c.id = o.author_id
     where ${conditions.join(' and ')}
     order by o.seq desc limit $${values.length}`,
    values,
  );
  const page = rows.slice(0, filter.limit);
  const entries: HistoryEntry[] = page.map((row) => ({
    seq: Number(row.seq),
    opId: row.op.id,
    type: row.type,
    field: row.field,
    staffId: row.staff_id,
    staffName: row.staff_name,
    voice: row.voice as Voice,
    measure: row.measure,
    beat: row.beat,
    author: { id: row.author_id, name: row.author_name, role: row.author_role },
    at: row.at.toISOString(),
    summary: row.summary,
  }));
  const last = page[page.length - 1];
  return {
    entries,
    nextCursor: rows.length > filter.limit && last ? encodeHistoryCursor(Number(last.seq)) : null,
  };
}
