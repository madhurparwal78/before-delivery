import type { PoolClient } from 'pg';
import { VoiceDocument, type ScoreElement } from '../../shared/crdt.js';
import { MeterMap } from '../../shared/music.js';
import type {
  Clef,
  DurationName,
  ElementId,
  Part,
  PartLayout,
  PartStatus,
  PartSummary,
  Pitch,
  ScoreHead,
  SetField,
  Staff,
  TempoMark,
  TimeSignature,
  Voice,
} from '../../shared/types.js';
import { query } from '../db/pool.js';
import { errors } from '../errors.js';

interface ScoreRow {
  id: string;
  title: string;
  measure_count: number;
  lamport: number;
  last_seq: string;
}

interface StaffRow {
  id: string;
  name: string;
  clef: Clef;
  transpose_diatonic: number;
  transpose_chromatic: number;
  part_id: string;
  ord: number;
}

interface PartRow {
  id: string;
  name: string;
  status: PartStatus;
  revision: number;
  extracted_at_lamport: number | null;
  page_count: number | null;
  layout: PartLayout;
  extracted_layout: PartLayout | null;
  last_error: string | null;
  ord: number;
}

interface ElementRow {
  staff_id: string;
  voice: number;
  lamport: number;
  site: string;
  after_lamport: number | null;
  after_site: string | null;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  fields: Partial<Record<SetField, { value: unknown; stamp: ElementId }>>;
  delete_lamport: number | null;
  delete_site: string | null;
}

export interface ScoreState {
  head: ScoreHead;
  meter: MeterMap;
  staves: Staff[];
  parts: Part[];
  tempos: TempoMark[];
}

export function voiceKey(staffId: string, voice: Voice): string {
  return `${staffId}:${voice}`;
}

function toElement(row: ElementRow): ScoreElement {
  return {
    id: { lamport: row.lamport, site: row.site },
    after:
      row.after_lamport === null || row.after_site === null
        ? null
        : { lamport: row.after_lamport, site: row.after_site },
    kind: row.kind,
    pitch: row.pitch,
    duration: row.duration,
    dots: row.dots,
    fields: row.fields ?? {},
    deleted:
      row.delete_lamport === null || row.delete_site === null
        ? null
        : { lamport: row.delete_lamport, site: row.delete_site },
  };
}

export function partOf(row: PartRow, staffIds: string[], scoreLamport: number): Part {
  const layoutChanged =
    row.extracted_layout !== null &&
    JSON.stringify(row.extracted_layout) !== JSON.stringify(row.layout);
  const stale =
    row.status === 'ready' &&
    ((row.extracted_at_lamport ?? 0) < scoreLamport || layoutChanged);
  return {
    id: row.id,
    name: row.name,
    staffIds,
    status: row.status,
    revision: row.revision,
    extractedAtLamport: row.extracted_at_lamport,
    stale,
    pageCount: row.page_count,
    layout: row.layout,
    lastError: (row.last_error as Part['lastError']) ?? null,
  };
}

export async function loadScore(scoreId: string): Promise<ScoreState> {
  const scores = await query<ScoreRow>('select * from scores where id = $1', [scoreId]);
  const score = scores[0];
  if (!score) throw errors.notFound();
  const staffRows = await query<StaffRow>(
    'select * from staves where score_id = $1 order by ord asc',
    [scoreId],
  );
  const partRows = await query<PartRow>(
    'select * from parts where score_id = $1 order by ord asc',
    [scoreId],
  );
  const signatures = await query<{ measure: number; beats: number; beat_type: number }>(
    'select measure, beats, beat_type from time_signatures where score_id = $1 order by measure asc',
    [scoreId],
  );
  const tempoRows = await query<{ measure: number; bpm: number }>(
    'select measure, bpm from tempos where score_id = $1 order by measure asc',
    [scoreId],
  );

  const staves: Staff[] = staffRows.map((row, index) => ({
    id: row.id,
    name: row.name,
    clef: row.clef,
    transpose: { diatonic: row.transpose_diatonic, chromatic: row.transpose_chromatic },
    partId: row.part_id,
    order: index + 1,
  }));
  const staffIdsByPart = new Map<string, string[]>();
  for (const staff of staves) {
    const list = staffIdsByPart.get(staff.partId) ?? [];
    list.push(staff.id);
    staffIdsByPart.set(staff.partId, list);
  }
  const timeSignatures: TimeSignature[] = signatures.map((row) => ({
    measure: row.measure,
    beats: row.beats,
    beatType: row.beat_type,
  }));
  const tempos: TempoMark[] = tempoRows.map((row) => ({ measure: row.measure, bpm: row.bpm }));
  const parts = partRows.map((row) =>
    partOf(row, staffIdsByPart.get(row.id) ?? [], score.lamport),
  );
  const partSummaries: PartSummary[] = parts.map((part) => ({
    id: part.id,
    name: part.name,
    staffIds: part.staffIds,
  }));

  return {
    head: {
      id: score.id,
      title: score.title,
      measureCount: score.measure_count,
      timeSignatures,
      tempos,
      staves,
      parts: partSummaries,
      lamport: score.lamport,
      lastSeq: Number(score.last_seq),
    },
    meter: new MeterMap(timeSignatures),
    staves,
    parts,
    tempos,
  };
}

export async function loadVoices(
  scoreId: string,
  staffIds?: string[],
): Promise<Map<string, VoiceDocument>> {
  const rows = staffIds
    ? await query<ElementRow>(
        'select * from elements where score_id = $1 and staff_id = any($2::text[])',
        [scoreId, staffIds],
      )
    : await query<ElementRow>('select * from elements where score_id = $1', [scoreId]);
  const grouped = new Map<string, ScoreElement[]>();
  for (const row of rows) {
    const key = voiceKey(row.staff_id, row.voice as Voice);
    const list = grouped.get(key) ?? [];
    list.push(toElement(row));
    grouped.set(key, list);
  }
  const out = new Map<string, VoiceDocument>();
  for (const [key, elements] of grouped) out.set(key, VoiceDocument.from(elements));
  return out;
}

export function voiceOf(voices: Map<string, VoiceDocument>, staffId: string, voice: Voice): VoiceDocument {
  const key = voiceKey(staffId, voice);
  const found = voices.get(key);
  if (found) return found;
  const fresh = new VoiceDocument();
  voices.set(key, fresh);
  return fresh;
}

export async function writeElement(
  client: PoolClient,
  scoreId: string,
  staffId: string,
  voice: Voice,
  element: ScoreElement,
): Promise<void> {
  await client.query(
    `insert into elements (score_id, staff_id, voice, lamport, site, after_lamport, after_site,
        kind, pitch, duration, dots, fields, delete_lamport, delete_site)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13,$14)
     on conflict (score_id, lamport, site) do update set
       fields = excluded.fields,
       delete_lamport = excluded.delete_lamport,
       delete_site = excluded.delete_site`,
    [
      scoreId,
      staffId,
      voice,
      element.id.lamport,
      element.id.site,
      element.after?.lamport ?? null,
      element.after?.site ?? null,
      element.kind,
      element.pitch === null ? null : JSON.stringify(element.pitch),
      element.duration,
      element.dots,
      JSON.stringify(element.fields),
      element.deleted?.lamport ?? null,
      element.deleted?.site ?? null,
    ],
  );
}
