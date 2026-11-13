import { pool, query, type Queryable } from './db.js';
import {
  progressFor,
  representativeQualifying,
  type CompletenessSubject,
  type ProgramRules,
} from '../shared/completeness.js';
import type { Program, ProgramDetail, ProgramEdition, ProgramObjectRow } from '../shared/types.js';
import { notFound } from './errors.js';
import { readObservations, toCompletenessSubject } from './records.js';

export interface ProgramRecord {
  id: string;
  name: string;
  required_count: number;
  coordinator_name: string;
  coordinator_email: string;
  editions: ProgramEdition[];
  objects: Array<{ object_id: string; designation: string; name: string }>;
}

interface ProgramQueryRow {
  id: string;
  name: string;
  required_count: number;
  coordinator_name: string;
  coordinator_email: string;
  editions: ProgramEdition[];
  objects: Array<{ object_id: string; designation: string; name: string }>;
}

const PROGRAM_QUERY = `
  SELECT p.id, p.name, p.required_count, p.coordinator_name, p.coordinator_email,
    COALESCE((
      SELECT json_agg(json_build_object(
        'edition', e.edition,
        'effective_from', to_char(e.effective_from, 'YYYY-MM-DD'),
        'min_description', e.min_description,
        'sketch_required', e.sketch_required,
        'concentration_required', e.concentration_required,
        'pair_required', e.pair_required
      ) ORDER BY e.edition)
      FROM program_editions e WHERE e.program_id = p.id
    ), '[]'::json) AS editions,
    COALESCE((
      SELECT json_agg(json_build_object(
        'object_id', po.object_id, 'designation', c.designation, 'name', c.name
      ) ORDER BY po.position)
      FROM program_objects po JOIN catalogue_objects c ON c.id = po.object_id
      WHERE po.program_id = p.id
    ), '[]'::json) AS objects
  FROM programs p`;

export async function readProgramRecords(client: Queryable = pool): Promise<ProgramRecord[]> {
  const found = await client.query<ProgramQueryRow>(`${PROGRAM_QUERY} ORDER BY p.position`);
  return found.rows;
}

export async function readProgramRecord(
  programId: string,
  client: Queryable = pool,
): Promise<ProgramRecord> {
  const found = await client.query<ProgramQueryRow>(`${PROGRAM_QUERY} WHERE p.id = $1`, [
    programId,
  ]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export function programRules(record: ProgramRecord): ProgramRules {
  return {
    required_count: record.required_count,
    editions: record.editions,
    object_ids: record.objects.map((o) => o.object_id),
  };
}

function newestEdition(record: ProgramRecord): ProgramEdition {
  const latest = record.editions[record.editions.length - 1];
  if (!latest) throw new Error('a program always has at least one edition');
  return latest;
}

function toProgram(
  record: ProgramRecord,
  following: boolean,
  subjects: CompletenessSubject[],
): Program {
  const edition = newestEdition(record);
  return {
    id: record.id,
    name: record.name,
    required_count: record.required_count,
    sketch_required: edition.sketch_required,
    min_description: edition.min_description,
    concentration_required: edition.concentration_required,
    pair_required: edition.pair_required,
    editions: record.editions,
    coordinator_name: record.coordinator_name,
    coordinator_email: record.coordinator_email,
    following,
    progress: progressFor(subjects, programRules(record)),
  };
}

async function followedIds(accountId: string): Promise<Set<string>> {
  const found = await query<{ program_id: string }>(
    'SELECT program_id FROM program_follows WHERE account_id = $1',
    [accountId],
  );
  return new Set(found.rows.map((row) => row.program_id));
}

export async function listPrograms(accountId: string): Promise<Program[]> {
  const [records, following, observations] = await Promise.all([
    readProgramRecords(),
    followedIds(accountId),
    readObservations(accountId),
  ]);
  const subjects = observations.map(toCompletenessSubject);
  return records.map((record) => toProgram(record, following.has(record.id), subjects));
}

export async function getProgram(accountId: string, programId: string): Promise<ProgramDetail> {
  const [record, following, observations] = await Promise.all([
    readProgramRecord(programId),
    followedIds(accountId),
    readObservations(accountId),
  ]);
  const subjects = observations.map(toCompletenessSubject);
  const rules = programRules(record);
  const objects: ProgramObjectRow[] = record.objects.map((entry) => ({
    object_id: entry.object_id,
    designation: entry.designation,
    name: entry.name,
    qualifying_observation_id:
      representativeQualifying(subjects, entry.object_id, rules)?.id ?? null,
  }));
  return { ...toProgram(record, following.has(programId), subjects), objects };
}

export async function followProgram(accountId: string, programId: string): Promise<void> {
  await readProgramRecord(programId);
  await query(
    `INSERT INTO program_follows (account_id, program_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [accountId, programId],
  );
}

export async function unfollowProgram(accountId: string, programId: string): Promise<void> {
  await readProgramRecord(programId);
  await query('DELETE FROM program_follows WHERE account_id = $1 AND program_id = $2', [
    accountId,
    programId,
  ]);
}
