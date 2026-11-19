import { rows, type Queryable } from '../db/pool.js';
import { nightNumber } from '../domain/night.js';
import { instantToUtcString, type DateKey } from '../domain/time.js';
import type { SignCategory } from '../domain/signs.js';

export type Technique = 'none' | 'mild' | 'ssild';
export type MemoState = 'empty' | 'claimed' | 'stored';

export interface EntryRow {
  readonly id: string;
  readonly enrollment_id: string;
  readonly night_key: DateKey;
  readonly title: string;
  readonly text: string;
  readonly dreams_recalled: number;
  readonly lucid: boolean;
  readonly wbtb: boolean;
  readonly technique: Technique;
  readonly technique_minutes: number;
  readonly late_recall: boolean;
  readonly shared: boolean;
  readonly created_at: Date;
  readonly memo_state: MemoState;
  readonly memo_content_type: string | null;
  readonly memo_size_bytes: number | null;
  readonly memo_duration_ms: number | null;
  readonly memo_digest: string | null;
}

export interface SignRow {
  readonly id: string;
  readonly entry_id: string;
  readonly start_offset: number;
  readonly end_offset: number;
  readonly phrase: string;
  readonly category: SignCategory;
  readonly night_key: DateKey;
}

export interface SignView {
  readonly id: string;
  readonly entry_id: string;
  readonly start: number;
  readonly end: number;
  readonly phrase: string;
  readonly category: SignCategory;
  readonly night_key: DateKey;
}

export interface MemoView {
  readonly content_type: string;
  readonly size_bytes: number;
  readonly duration_ms: number;
}

export interface EntryView {
  readonly id: string;
  readonly night_key: DateKey;
  readonly night_number: number;
  readonly title: string;
  readonly text: string;
  readonly dreams_recalled: number;
  readonly lucid: boolean;
  readonly wbtb: boolean;
  readonly technique: Technique;
  readonly technique_minutes: number;
  readonly late_recall: boolean;
  readonly shared: boolean;
  readonly created_at: string;
  readonly memo: MemoView | null;
  readonly signs: readonly SignView[];
}

export const ENTRY_COLUMNS = `
  id, enrollment_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique,
  technique_minutes, late_recall, shared, created_at, memo_state, memo_content_type,
  memo_size_bytes, memo_duration_ms, memo_digest`;

export function signView(row: SignRow): SignView {
  return {
    id: row.id,
    entry_id: row.entry_id,
    start: row.start_offset,
    end: row.end_offset,
    phrase: row.phrase,
    category: row.category,
    night_key: row.night_key,
  };
}

export function memoView(row: EntryRow): MemoView | null {
  if (
    row.memo_state !== 'stored' ||
    row.memo_content_type === null ||
    row.memo_size_bytes === null ||
    row.memo_duration_ms === null
  ) {
    return null;
  }
  return {
    content_type: row.memo_content_type,
    size_bytes: row.memo_size_bytes,
    duration_ms: row.memo_duration_ms,
  };
}

export function entryView(
  row: EntryRow,
  signs: readonly SignRow[],
  firstNight: DateKey | null,
): EntryView {
  return {
    id: row.id,
    night_key: row.night_key,
    night_number: nightNumber(row.night_key, firstNight),
    title: row.title,
    text: row.text,
    dreams_recalled: row.dreams_recalled,
    lucid: row.lucid,
    wbtb: row.wbtb,
    technique: row.technique,
    technique_minutes: row.technique_minutes,
    late_recall: row.late_recall,
    shared: row.shared,
    created_at: instantToUtcString(row.created_at),
    memo: memoView(row),
    signs: signs
      .filter((sign) => sign.entry_id === row.id)
      .sort((left, right) => left.start_offset - right.start_offset)
      .map(signView),
  };
}

export async function findEntry(
  id: string,
  client?: Queryable,
): Promise<EntryRow | null> {
  const found = await rows<EntryRow>(
    `select ${ENTRY_COLUMNS} from entries where id = $1`,
    [id],
    client,
  );
  return found[0] ?? null;
}

export async function listEntries(enrollmentId: string): Promise<EntryRow[]> {
  return rows<EntryRow>(
    `select ${ENTRY_COLUMNS} from entries where enrollment_id = $1
      order by night_key desc, created_at desc`,
    [enrollmentId],
  );
}

export async function listSignsOfEntries(entryIds: readonly string[]): Promise<SignRow[]> {
  if (entryIds.length === 0) return [];
  return rows<SignRow>(
    `select id, entry_id, start_offset, end_offset, phrase, category, night_key
       from signs where entry_id = any($1::uuid[]) order by created_at`,
    [`{${entryIds.join(',')}}`],
  );
}

export async function listSignsOfEntry(
  entryId: string,
  client?: Queryable,
): Promise<SignRow[]> {
  return rows<SignRow>(
    `select id, entry_id, start_offset, end_offset, phrase, category, night_key
       from signs where entry_id = $1 order by created_at`,
    [entryId],
    client,
  );
}
