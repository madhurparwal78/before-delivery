import type { PoolClient } from 'pg';
import { one, query } from './db.js';
import { nowMs } from './clock.js';
import { analyze } from './domain/analyze.js';
import {
  flattenEvent,
  inferType,
  resolveFields,
  typeOfValue,
  valueFits,
  type EventFields,
  type FieldType,
  type GenerationMapping,
  type ResolvedField,
} from './domain/mapping.js';
import { getObject, isStorageDown } from './storage.js';

export const STREAM_MAX_EVENTS = 100000;

export type Phase = 'hot' | 'warm' | 'archive' | 'deleted';

export type StreamRow = {
  id: number;
  spaceId: number;
  name: string;
  writeGeneration: number;
  pipelineName: string | null;
  policy: LifecyclePolicy;
};

export type LifecyclePolicy = {
  rollover_max_age_ms: number | null;
  rollover_max_events: number | null;
  warm_after_ms: number | null;
  archive_after_ms: number | null;
  delete_after_ms: number | null;
};

export type GenerationRow = {
  id: number;
  streamId: number;
  number: number;
  phase: Phase;
  createdMs: number;
  becameWriteMs: number;
  rolledOverMs: number | null;
  segmentKey: string | null;
  segmentBytes: number | null;
  minTsMs: number | null;
  maxTsMs: number | null;
  eventCount: number;
  archiveFailed: boolean;
  deleteFailed: boolean;
};

export type LoadedEvent = {
  row: string;
  eventId: string;
  tsMs: number;
  storedMs: number;
  generation: number;
  phase: Phase;
  pipeline: string | null;
  fields: EventFields;
  raw: Record<string, unknown>;
};

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export async function streamByName(spaceId: number, name: string): Promise<StreamRow | null> {
  const row = await one(`select * from streams where space_id = $1 and name = $2`, [spaceId, name]);
  return row ? streamRow(row) : null;
}

export async function streamById(id: number): Promise<StreamRow | null> {
  const row = await one(`select * from streams where id = $1`, [id]);
  return row ? streamRow(row) : null;
}

export async function listStreams(spaceId: number): Promise<StreamRow[]> {
  const rows = await query(`select * from streams where space_id = $1 order by name asc`, [spaceId]);
  return rows.map(streamRow);
}

function streamRow(row: Record<string, unknown>): StreamRow {
  return {
    id: Number(row.id),
    spaceId: Number(row.space_id),
    name: String(row.name),
    writeGeneration: Number(row.write_generation),
    pipelineName: row.pipeline_name === null ? null : String(row.pipeline_name),
    policy: {
      rollover_max_age_ms: numberOrNull(row.rollover_max_age_ms),
      rollover_max_events: numberOrNull(row.rollover_max_events),
      warm_after_ms: numberOrNull(row.warm_after_ms),
      archive_after_ms: numberOrNull(row.archive_after_ms),
      delete_after_ms: numberOrNull(row.delete_after_ms),
    },
  };
}

function generationRow(row: Record<string, unknown>): GenerationRow {
  return {
    id: Number(row.id),
    streamId: Number(row.stream_id),
    number: Number(row.number),
    phase: String(row.phase) as Phase,
    createdMs: Number(row.created_ms),
    becameWriteMs: Number(row.became_write_ms),
    rolledOverMs: numberOrNull(row.rolled_over_ms),
    segmentKey: row.segment_key === null ? null : String(row.segment_key),
    segmentBytes: numberOrNull(row.segment_bytes),
    minTsMs: numberOrNull(row.min_ts_ms),
    maxTsMs: numberOrNull(row.max_ts_ms),
    eventCount: Number(row.event_count),
    archiveFailed: Boolean(row.archive_failed),
    deleteFailed: Boolean(row.delete_failed),
  };
}

export async function generationsOf(streamId: number): Promise<GenerationRow[]> {
  const rows = await query(`select * from generations where stream_id = $1 order by number asc`, [streamId]);
  return rows.map(generationRow);
}

export async function createGeneration(
  streamId: number,
  number: number,
  phase: Phase,
  createdMs: number,
): Promise<GenerationRow> {
  const row = await one(
    `insert into generations (stream_id, number, phase, created_ms, became_write_ms)
     values ($1, $2, $3, $4, $4)
     on conflict (stream_id, number) do update set phase = generations.phase
     returning *`,
    [streamId, number, phase, createdMs],
  );
  return generationRow(row as Record<string, unknown>);
}

export async function writeGenerationOf(stream: StreamRow): Promise<GenerationRow> {
  const generations = await generationsOf(stream.id);
  const found = generations.find((generation) => generation.number === stream.writeGeneration);
  if (found) return found;
  return createGeneration(stream.id, stream.writeGeneration, 'hot', nowMs());
}

export async function mappingsOf(streamId: number): Promise<Map<number, Map<string, FieldType>>> {
  const rows = await query(
    `select g.number as generation, m.field, m.type
     from mappings m join generations g on g.id = m.generation_id
     where g.stream_id = $1`,
    [streamId],
  );
  const out = new Map<number, Map<string, FieldType>>();
  for (const row of rows) {
    const generation = Number(row.generation);
    let types = out.get(generation);
    if (!types) {
      types = new Map();
      out.set(generation, types);
    }
    types.set(String(row.field), String(row.type) as FieldType);
  }
  return out;
}

export async function mappingRows(
  streamId: number,
): Promise<{ field: string; type: FieldType; generation: number; explicit: boolean }[]> {
  const rows = await query(
    `select g.number as generation, m.field, m.type, m.explicit
     from mappings m join generations g on g.id = m.generation_id
     where g.stream_id = $1
     order by g.number asc, m.field asc`,
    [streamId],
  );
  return rows.map((row) => ({
    field: String(row.field),
    type: String(row.type) as FieldType,
    generation: Number(row.generation),
    explicit: Boolean(row.explicit),
  }));
}

export function resolveFieldsOf(
  mappings: Map<number, Map<string, FieldType>>,
  generations: number[],
): ResolvedField[] {
  const picked: GenerationMapping[] = [];
  for (const generation of generations) {
    const types = mappings.get(generation);
    if (types) picked.push({ generation, types });
  }
  return resolveFields(picked);
}

export async function explicitMappingsOf(generationId: number): Promise<Map<string, FieldType>> {
  const rows = await query(`select field, type from mappings where generation_id = $1 and explicit`, [
    generationId,
  ]);
  return new Map(rows.map((row) => [String(row.field), String(row.type) as FieldType]));
}

export type WriteOutcome =
  | { status: 'created'; eventId: string }
  | { status: 'duplicate' }
  | { status: 'failed'; reason: string };

export type WriteInput = {
  spaceId: number;
  stream: StreamRow;
  generation: GenerationRow;
  eventId: string;
  tsMs: number;
  raw: Record<string, unknown>;
  pipeline: string | null;
};

/** The one place an event, its mapping and its index entries are written. */
export async function writeEvent(client: PoolClient, input: WriteInput): Promise<WriteOutcome> {
  const fields = flattenEvent(input.raw);
  const mapped = await client.query<{ field: string; type: string }>(
    `select field, type from mappings where generation_id = $1`,
    [input.generation.id],
  );
  const types = new Map<string, FieldType>(
    mapped.rows.map((row) => [row.field, row.type as FieldType]),
  );
  const additions: [string, FieldType][] = [];
  for (const [field, value] of Object.entries(fields)) {
    const known = types.get(field);
    if (known === undefined) {
      const inferred = inferType(value);
      types.set(field, inferred);
      additions.push([field, inferred]);
      continue;
    }
    if (!valueFits(value, known)) {
      return {
        status: 'failed',
        reason: `field ${field} expects ${known}, got ${typeOfValue(value)}`,
      };
    }
  }
  const stored = nowMs();
  const inserted = await client.query<{ id: string }>(
    `insert into events (space_id, stream_id, generation_id, event_id, ts_ms, stored_ms, fields, raw, pipeline)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (stream_id, event_id) do nothing
     returning id`,
    [
      input.spaceId,
      input.stream.id,
      input.generation.id,
      input.eventId,
      input.tsMs,
      stored,
      JSON.stringify(fields),
      JSON.stringify(input.raw),
      input.pipeline,
    ],
  );
  if (inserted.rows.length === 0) return { status: 'duplicate' };
  const eventRow = inserted.rows[0].id;
  for (const [field, type] of additions) {
    await client.query(
      `insert into mappings (generation_id, field, type, explicit) values ($1, $2, $3, false)
       on conflict (generation_id, field) do nothing`,
      [input.generation.id, field, type],
    );
  }
  await indexEventFields(client, {
    eventRow,
    streamId: input.stream.id,
    generationId: input.generation.id,
    fields,
    types,
    fresh: true,
  });
  await client.query(
    `update generations set event_count = event_count + 1,
       min_ts_ms = least(coalesce(min_ts_ms, $2), $2),
       max_ts_ms = greatest(coalesce(max_ts_ms, $2), $2)
     where id = $1`,
    [input.generation.id, input.tsMs],
  );
  return { status: 'created', eventId: input.eventId };
}

/** The app's own term index: one posting row per token of a text field. */
export async function indexEventFields(
  client: PoolClient,
  input: {
    eventRow: string;
    streamId: number;
    generationId: number;
    fields: EventFields;
    types: Map<string, FieldType>;
    fresh?: boolean;
  },
): Promise<void> {
  if (input.fresh !== true) {
    await client.query(`delete from postings where event_row = $1`, [input.eventRow]);
    await client.query(`delete from doc_lengths where event_row = $1`, [input.eventRow]);
  }
  for (const [field, value] of Object.entries(input.fields)) {
    if (input.types.get(field) !== 'text') continue;
    const postings = buildPostings(value);
    if (postings.tokens.length > 0) {
      const values: unknown[] = [input.streamId, input.generationId, field, input.eventRow];
      const rows = postings.tokens.map((posting) => {
        const base = values.length;
        values.push(posting.token, posting.positions.length, posting.positions, posting.starts, posting.ends);
        return `($1, $2, $3, $${base + 1}, $4, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      await client.query(
        `insert into postings (stream_id, generation_id, field, token, event_row, tf, positions, starts, ends)
         values ${rows.join(', ')}`,
        values,
      );
    }
    await client.query(
      `insert into doc_lengths (event_row, stream_id, field, dl) values ($1, $2, $3, $4)
       on conflict (event_row, field) do update set dl = excluded.dl`,
      [input.eventRow, input.streamId, field, postings.dl],
    );
  }
}

export type TokenPosting = { token: string; positions: number[]; starts: number[]; ends: number[] };

/** The one place postings of a text value are built, used by the index and by segment reads. */
export function buildPostings(value: EventFields[string]): { tokens: TokenPosting[]; dl: number } {
  const values = Array.isArray(value) ? value : [value];
  const byToken = new Map<string, TokenPosting>();
  let position = 0;
  let dl = 0;
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const tokens = analyze('standard', item);
    for (const token of tokens) {
      let entry = byToken.get(token.token);
      if (!entry) {
        entry = { token: token.token, positions: [], starts: [], ends: [] };
        byToken.set(token.token, entry);
      }
      entry.positions.push(position + token.position);
      entry.starts.push(token.start);
      entry.ends.push(token.end);
      dl += 1;
    }
    position += tokens.length === 0 ? 0 : tokens[tokens.length - 1].position + 1;
  }
  return { tokens: [...byToken.values()], dl };
}

export async function countStreamEvents(streamId: number): Promise<number> {
  const row = await one<{ total: string }>(
    `select coalesce(sum(event_count), 0)::text as total from generations where stream_id = $1 and phase <> 'deleted'`,
    [streamId],
  );
  return Number(row?.total ?? '0');
}

export async function countFailures(streamId: number): Promise<number> {
  const row = await one<{ total: string }>(
    `select count(*)::text as total from failures where stream_id = $1`,
    [streamId],
  );
  return Number(row?.total ?? '0');
}

export async function spaceTotals(spaceId: number): Promise<{ stored: number; failed: number }> {
  const stored = await one<{ total: string }>(
    `select coalesce(sum(g.event_count), 0)::text as total
     from generations g join streams s on s.id = g.stream_id
     where s.space_id = $1 and g.phase <> 'deleted'`,
    [spaceId],
  );
  const failed = await one<{ total: string }>(
    `select count(*)::text as total from failures where space_id = $1`,
    [spaceId],
  );
  return { stored: Number(stored?.total ?? '0'), failed: Number(failed?.total ?? '0') };
}

export function eventFromRow(row: Record<string, unknown>): LoadedEvent {
  return {
    row: String(row.id),
    eventId: String(row.event_id),
    tsMs: Number(row.ts_ms),
    storedMs: Number(row.stored_ms),
    generation: Number(row.generation),
    phase: String(row.phase) as Phase,
    pipeline: row.pipeline === null ? null : String(row.pipeline),
    fields: row.fields as EventFields,
    raw: row.raw as Record<string, unknown>,
  };
}

export type RangeLoad = {
  events: LoadedEvent[];
  partial: boolean;
  skippedGenerations: number;
  archiveRows: Map<string, LoadedEvent>;
};

export function serializeSegmentEvent(event: LoadedEvent): string {
  return JSON.stringify({
    _id: event.eventId,
    '@timestamp': new Date(event.tsMs).toISOString(),
    _generation: event.generation,
    _pipeline: event.pipeline,
    stored_ms: event.storedMs,
    fields: event.fields,
    raw: event.raw,
  });
}

function parseSegment(text: string, generation: number): LoadedEvent[] {
  const out: LoadedEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const parsed = JSON.parse(line) as {
      _id: string;
      '@timestamp': string;
      _pipeline: string | null;
      stored_ms: number;
      fields: EventFields;
      raw: Record<string, unknown>;
    };
    out.push({
      row: `segment:${generation}:${parsed._id}`,
      eventId: parsed._id,
      tsMs: Date.parse(parsed['@timestamp']),
      storedMs: Number(parsed.stored_ms),
      generation,
      phase: 'archive',
      pipeline: parsed._pipeline,
      fields: parsed.fields,
      raw: parsed.raw,
    });
  }
  return out;
}

export async function readSegment(generation: GenerationRow): Promise<LoadedEvent[]> {
  const key = generation.segmentKey;
  if (!key) return [];
  const body = await getObject(key);
  return parseSegment(body.toString('utf8'), generation.number);
}

/** Loads every event of a stream in [fromMs, toMs), reading archived generations back from storage. */
export async function loadRange(
  stream: StreamRow,
  fromMs: number,
  toMs: number,
  generations: GenerationRow[],
): Promise<RangeLoad> {
  const rows = await query(
    `select e.id, e.event_id, e.ts_ms, e.stored_ms, e.fields, e.raw, e.pipeline, g.number as generation, g.phase
     from events e join generations g on g.id = e.generation_id
     where e.stream_id = $1 and e.ts_ms >= $2 and e.ts_ms < $3`,
    [stream.id, fromMs, toMs],
  );
  const events = rows.map(eventFromRow);
  const archiveRows = new Map<string, LoadedEvent>();
  let skippedGenerations = 0;
  for (const generation of generations) {
    if (generation.phase !== 'archive' || !generation.segmentKey) continue;
    const minTs = generation.minTsMs ?? Number.NEGATIVE_INFINITY;
    const maxTs = generation.maxTsMs ?? Number.POSITIVE_INFINITY;
    if (maxTs < fromMs || minTs >= toMs) continue;
    try {
      const segment = await readSegment(generation);
      for (const event of segment) {
        if (event.tsMs < fromMs || event.tsMs >= toMs) continue;
        events.push(event);
        archiveRows.set(event.row, event);
      }
    } catch (cause) {
      if (isStorageDown(cause)) {
        skippedGenerations += 1;
        continue;
      }
      throw cause;
    }
  }
  return { events, partial: skippedGenerations > 0, skippedGenerations, archiveRows };
}

export async function eventByIdAnywhere(
  stream: StreamRow,
  eventId: string,
): Promise<{ event: LoadedEvent; generationId: number | null } | null> {
  const row = await one(
    `select e.id, e.event_id, e.ts_ms, e.stored_ms, e.fields, e.raw, e.pipeline, e.generation_id,
            g.number as generation, g.phase
     from events e join generations g on g.id = e.generation_id
     where e.stream_id = $1 and e.event_id = $2`,
    [stream.id, eventId],
  );
  if (row) {
    return { event: eventFromRow(row), generationId: Number(row.generation_id) };
  }
  const generations = await generationsOf(stream.id);
  for (const generation of generations) {
    if (generation.phase !== 'archive') continue;
    const segment = await readSegment(generation);
    const found = segment.find((event) => event.eventId === eventId);
    if (found) return { event: found, generationId: generation.id };
  }
  return null;
}

export type PostingEntry = { tf: number; positions: number[]; starts: number[]; ends: number[] };

export async function postingsFor(
  streamId: number,
  field: string,
  token: string,
): Promise<Map<string, PostingEntry>> {
  const rows = await query(
    `select event_row, tf, positions, starts, ends from postings
     where stream_id = $1 and field = $2 and token = $3`,
    [streamId, field, token],
  );
  const out = new Map<string, PostingEntry>();
  for (const row of rows) {
    out.set(String(row.event_row), {
      tf: Number(row.tf),
      positions: (row.positions as number[]) ?? [],
      starts: (row.starts as number[]) ?? [],
      ends: (row.ends as number[]) ?? [],
    });
  }
  return out;
}

export async function dictionaryTokens(streamId: number, field: string): Promise<string[]> {
  const rows = await query(
    `select distinct token from postings where stream_id = $1 and field = $2`,
    [streamId, field],
  );
  return rows.map((row) => String(row.token));
}

export async function docLengthsFor(
  streamId: number,
  field: string,
): Promise<Map<string, number>> {
  const rows = await query(`select event_row, dl from doc_lengths where stream_id = $1 and field = $2`, [
    streamId,
    field,
  ]);
  return new Map(rows.map((row) => [String(row.event_row), Number(row.dl)]));
}

export async function addFailure(
  spaceId: number,
  streamId: number,
  reason: string,
  raw: string,
): Promise<void> {
  await query(`insert into failures (space_id, stream_id, reason, raw, at_ms) values ($1, $2, $3, $4, $5)`, [
    spaceId,
    streamId,
    reason,
    raw,
    nowMs(),
  ]);
}
