import type { PoolClient } from 'pg';
import { VoiceDocument } from '../../shared/crdt.js';
import { DURATION_TICKS, MAX_MEASURES, idKey } from '../../shared/music.js';
import { TEXT_LIMIT, filterText, graphemeCount, textWithoutTags } from '../../shared/text.js';
import type {
  ElementId,
  OpLogEntry,
  Operation,
  Pitch,
  SetField,
  Voice,
} from '../../shared/types.js';
import { query, transact } from '../db/pool.js';
import { errors, type FieldErrors } from '../errors.js';
import { broadcast } from '../services/valkey.js';
import { canEditStaff, type CollaboratorRow } from './collaborators.js';
import {
  loadScore,
  loadVoices,
  voiceKey,
  voiceOf,
  writeElement,
  type ScoreState,
} from './score.js';
import { summaryFor } from './summary.js';
import { reserveOperations } from './throttle.js';

const SET_FIELDS: SetField[] = [
  'pitch',
  'duration',
  'dots',
  'tie',
  'dynamic',
  'dynamicPlacement',
  'text',
];
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp'];
const STEPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const MAX_OPS_PER_BATCH = 50;

export interface ApplyResult {
  applied: ElementId[];
  duplicates: ElementId[];
  lamport: number;
  lastSeq: number;
  entries: OpLogEntry[];
  measureCountChanged: boolean;
}

interface PreparedOp {
  op: Operation;
  summary: string;
  measure: number;
  beat: number;
}

function isPitch(value: unknown): value is Pitch {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.step === 'string' &&
    STEPS.includes(candidate.step) &&
    typeof candidate.alter === 'number' &&
    Number.isInteger(candidate.alter) &&
    candidate.alter >= -2 &&
    candidate.alter <= 2 &&
    typeof candidate.octave === 'number' &&
    Number.isInteger(candidate.octave) &&
    candidate.octave >= 0 &&
    candidate.octave <= 9
  );
}

function shapeErrors(ops: unknown, callerId: string): FieldErrors {
  const found: FieldErrors = {};
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS_PER_BATCH) {
    return { ops: 'Send 1 to 50 operations.' };
  }
  ops.forEach((raw, index) => {
    const op = raw as Record<string, unknown>;
    const at = (field: string, message: string): void => {
      const key = `ops[${index}].${field}`;
      if (!(key in found)) found[key] = message;
    };
    const id = op.id as Record<string, unknown> | undefined;
    if (
      typeof id !== 'object' ||
      id === null ||
      typeof id.lamport !== 'number' ||
      !Number.isInteger(id.lamport) ||
      id.lamport < 1 ||
      typeof id.site !== 'string'
    ) {
      at('id', 'Use a whole stamp of 1 or more with your collaborator id.');
    } else if (id.site !== callerId) {
      at('id', 'Site must be your collaborator id.');
    }
    if (typeof op.staffId !== 'string') at('staffId', 'Unknown staff.');
    if (op.voice !== 1 && op.voice !== 2) at('voice', 'Use voice 1 or 2.');
    if (op.type === 'insert') {
      const event = op.event as Record<string, unknown> | undefined;
      if (typeof event !== 'object' || event === null) {
        at('event', 'Describe the note or rest.');
      } else {
        if (event.kind !== 'note' && event.kind !== 'rest') at('event.kind', 'Use a note or a rest.');
        if (typeof event.duration !== 'string' || !(event.duration in DURATION_TICKS)) {
          at('event.duration', 'Unknown duration.');
        }
        if (
          typeof event.dots !== 'number' ||
          !Number.isInteger(event.dots) ||
          event.dots < 0 ||
          event.dots > 2
        ) {
          at('event.dots', 'Use 0, 1 or 2 dots.');
        }
        if (event.kind === 'rest' && event.pitch !== undefined) at('event.pitch', 'Rests have no pitch.');
        if (event.kind === 'note' && !isPitch(event.pitch)) at('event.pitch', 'Unknown pitch.');
      }
      if (op.after !== null && typeof op.after !== 'object') at('after', 'Unknown element.');
    } else if (op.type === 'delete') {
      if (typeof op.target !== 'object' || op.target === null) at('target', 'Unknown element.');
    } else if (op.type === 'set') {
      if (typeof op.target !== 'object' || op.target === null) at('target', 'Unknown element.');
      if (typeof op.field !== 'string' || !SET_FIELDS.includes(op.field as SetField)) {
        at('field', 'Unknown field.');
      } else {
        const value = op.value;
        const field = op.field as SetField;
        if (field === 'pitch' && !isPitch(value)) at('value', 'Unknown pitch.');
        if (field === 'duration' && (typeof value !== 'string' || !(value in DURATION_TICKS))) {
          at('value', 'Unknown duration.');
        }
        if (
          field === 'dots' &&
          (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2)
        ) {
          at('value', 'Use 0, 1 or 2 dots.');
        }
        if (field === 'tie' && typeof value !== 'boolean') at('value', 'Use true or false.');
        if (field === 'dynamic' && value !== null && (typeof value !== 'string' || !DYNAMICS.includes(value))) {
          at('value', 'Unknown dynamic.');
        }
        if (field === 'dynamicPlacement' && value !== 'above' && value !== 'below') {
          at('value', 'Use above or below.');
        }
        if (field === 'text') {
          if (typeof value !== 'string') {
            at('value', 'Use text.');
          } else if (graphemeCount(textWithoutTags(filterText(value))) > TEXT_LIMIT) {
            at('value', 'Expression text is limited to 200 characters.');
          }
        }
      }
    } else {
      at('type', 'Unknown operation type.');
    }
  });
  return found;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function subjectOf(document: VoiceDocument, id: ElementId) {
  const element = document.get(id)!;
  const { duration, dots } = document.resolvedDuration(element);
  return { kind: element.kind, pitch: document.resolvedPitch(element), duration, dots };
}

export async function applyOperations(
  scoreId: string,
  caller: CollaboratorRow,
  rawOps: unknown,
  seen: number | undefined,
): Promise<ApplyResult> {
  const state = await loadScore(scoreId);
  const staffById = new Map(state.staves.map((staff) => [staff.id, staff]));

  if (Array.isArray(rawOps)) {
    for (const raw of rawOps) {
      const staffId = (raw as { staffId?: unknown }).staffId;
      if (typeof staffId === 'string' && staffById.has(staffId) && !canEditStaff(caller, staffId)) {
        throw errors.forbiddenStaff();
      }
    }
  }

  const count = Array.isArray(rawOps) ? rawOps.length : 1;
  const reservation = await reserveOperations(caller.id, count);
  if (!reservation.allowed) throw errors.rateLimited(reservation.retryAfterSeconds);

  try {
    const shape = shapeErrors(rawOps, caller.id);
    if (Object.keys(shape).length > 0) throw errors.validation(shape);
    const ops = rawOps as Operation[];

    const unknownStaff: FieldErrors = {};
    ops.forEach((op, index) => {
      if (!staffById.has(op.staffId)) unknownStaff[`ops[${index}].staffId`] = 'Unknown staff.';
    });
    if (Object.keys(unknownStaff).length > 0) throw errors.validation(unknownStaff);

    const normalised = ops.map((op) =>
      op.type === 'set' && op.field === 'text'
        ? { ...op, value: filterText(op.value as string) }
        : op,
    );
    const staffIds = [...new Set(normalised.map((op) => op.staffId))];
    const voices = await loadVoices(scoreId, staffIds);
    return await recordBatch(scoreId, caller, normalised, voices, state, seen);
  } catch (cause) {
    await reservation.release();
    throw cause;
  }
}

async function recordBatch(
  scoreId: string,
  caller: CollaboratorRow,
  ops: Operation[],
  voices: Map<string, VoiceDocument>,
  state: ScoreState,
  seen: number | undefined,
): Promise<ApplyResult> {
  const recorded = await transact(async (client) => {
    const scoreRows = await client.query<{ lamport: number; last_seq: string; measure_count: number }>(
      'select lamport, last_seq, measure_count from scores where id = $1 for update',
      [scoreId],
    );
    const score = scoreRows.rows[0]!;

    const stampRows = await client.query<{ op_lamport: number; op_site: string; op: Operation }>(
      `select op_lamport, op_site, op from operations
       where score_id = $1 and (op_lamport, op_site) in (${ops
         .map((_, index) => `($${index * 2 + 2}, $${index * 2 + 3})`)
         .join(', ')})`,
      [scoreId, ...ops.flatMap((op) => [op.id.lamport, op.id.site])],
    );
    const already = new Map(
      stampRows.rows.map((row) => [`${row.op_lamport}@${row.op_site}`, row.op]),
    );

    const duplicates: ElementId[] = [];
    const fresh: Operation[] = [];
    for (const op of ops) {
      const held = already.get(idKey(op.id));
      if (!held) {
        fresh.push(op);
        continue;
      }
      if (canonical(held) !== canonical(op)) {
        throw errors.opConflict(op.id.lamport, op.id.site);
      }
      duplicates.push(op.id);
    }

    const referenceErrors: FieldErrors = {};
    const prepared: PreparedOp[] = [];
    const touched = new Set<string>();

    ops.forEach((op, index) => {
      const document = voiceOf(voices, op.staffId, op.voice as Voice);
      const key = `ops[${index}]`;
      if (op.type === 'insert') {
        if (op.after !== null) {
          if (!document.has(op.after)) {
            referenceErrors[`${key}.after`] = 'Unknown element.';
            return;
          }
          if (op.id.lamport <= op.after.lamport) {
            referenceErrors[`${key}.id`] = 'Stamp must be later than the element it refers to.';
            return;
          }
        }
      } else {
        if (!document.has(op.target)) {
          referenceErrors[`${key}.target`] = 'Unknown element.';
          return;
        }
        if (op.id.lamport <= op.target.lamport) {
          referenceErrors[`${key}.id`] = 'Stamp must be later than the element it refers to.';
          return;
        }
        if (op.type === 'set' && op.field === 'pitch' && document.get(op.target)!.kind === 'rest') {
          referenceErrors[`${key}.value`] = 'Rests have no pitch.';
          return;
        }
      }
      if (already.has(idKey(op.id))) return;
      document.apply(op);
      touched.add(voiceKey(op.staffId, op.voice as Voice));
      const subjectId = op.type === 'insert' ? op.id : op.target;
      const offset = document.offsetOf(subjectId) ?? 0;
      const position = state.meter.position(offset);
      prepared.push({
        op,
        summary: summaryFor(op, subjectOf(document, subjectId)),
        measure: position.measure,
        beat: position.beat,
      });
    });

    if (Object.keys(referenceErrors).length > 0) throw errors.validation(referenceErrors);

    let measureCount = score.measure_count;
    for (const key of touched) {
      const document = voices.get(key)!;
      const needed = state.meter.measuresNeeded(document.totalTicks());
      if (needed > MAX_MEASURES) {
        throw errors.validation({ measures: 'A score holds at most 2,000 measures.' });
      }
      measureCount = Math.max(measureCount, needed);
    }

    let lamport = score.lamport;
    let seq = Number(score.last_seq);
    const entries: OpLogEntry[] = [];
    for (const item of prepared) {
      const op = item.op;
      lamport = Math.max(lamport, op.id.lamport);
      seq += 1;
      const document = voices.get(voiceKey(op.staffId, op.voice as Voice))!;
      const subjectId = op.type === 'insert' ? op.id : op.target;
      await writeElement(client, scoreId, op.staffId, op.voice as Voice, document.get(subjectId)!);
      await client.query(
        `insert into operations (score_id, seq, op_lamport, op_site, op, type, field, staff_id, voice,
            measure, beat, summary, author_id)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          scoreId,
          seq,
          op.id.lamport,
          op.id.site,
          JSON.stringify(op),
          op.type,
          op.type === 'set' ? op.field : null,
          op.staffId,
          op.voice,
          item.measure,
          item.beat,
          item.summary,
          caller.id,
        ],
      );
      entries.push({
        seq,
        op,
        author: { id: caller.id, name: caller.name, role: caller.role },
      });
    }

    const ackedLamport = Math.max(caller.acked_lamport, seen ?? 0);
    await client.query('update collaborators set acked_lamport = $2 where id = $1', [
      caller.id,
      ackedLamport,
    ]);
    await client.query(
      'update scores set lamport = $2, last_seq = $3, measure_count = $4 where id = $1',
      [scoreId, lamport, seq, measureCount],
    );
    await compactIfDue(client, scoreId, Number(score.last_seq), seq);

    return {
      applied: prepared.map((item) => item.op.id),
      duplicates,
      lamport,
      lastSeq: seq,
      entries,
      measureCountChanged: measureCount > score.measure_count,
    };
  });

  if (recorded.entries.length > 0) {
    await broadcast.publish(scoreId, { type: 'ops', entries: recorded.entries });
  }
  if (recorded.measureCountChanged) {
    const refreshed = await loadScore(scoreId);
    await broadcast.publish(scoreId, { type: 'score', score: refreshed.head });
  }
  return recorded;
}

/** Snapshots every hundredth operation, dropping tombstones that are causally stable. */
async function compactIfDue(
  client: PoolClient,
  scoreId: string,
  previousSeq: number,
  seq: number,
): Promise<void> {
  const milestone = Math.floor(seq / 100) * 100;
  if (milestone <= Math.floor(previousSeq / 100) * 100 || milestone === 0) return;
  const stable = await client.query<{ stable: number | null }>(
    `select min(acked_lamport) as stable from collaborators
     where score_id = $1 and status = 'active'`,
    [scoreId],
  );
  const stableLamport = stable.rows[0]?.stable ?? 0;
  await client.query(
    `insert into snapshots (score_id, seq, stable_lamport) values ($1, $2, $3)
     on conflict (score_id, seq) do nothing`,
    [scoreId, milestone, stableLamport],
  );
  await client.query(
    'delete from elements where score_id = $1 and delete_lamport is not null and delete_lamport <= $2',
    [scoreId, stableLamport],
  );
}

export async function readOpsSince(
  scoreId: string,
  afterSeq: number,
  limit: number,
): Promise<{ ops: OpLogEntry[]; lastSeq: number; lamport: number }> {
  const state = await loadScore(scoreId);
  const rows = await query<{
    seq: string;
    op: Operation;
    author_id: string;
    name: string;
    role: OpLogEntry['author']['role'];
  }>(
    `select o.seq, o.op, o.author_id, c.name, c.role from operations o
     join collaborators c on c.id = o.author_id
     where o.score_id = $1 and o.seq > $2 order by o.seq asc limit $3`,
    [scoreId, afterSeq, limit],
  );
  return {
    ops: rows.map((row) => ({
      seq: Number(row.seq),
      op: row.op,
      author: { id: row.author_id, name: row.name, role: row.role },
    })),
    lastSeq: state.head.lastSeq,
    lamport: state.head.lamport,
  };
}

export async function syncState(scoreId: string): Promise<{
  lamport: number;
  stableLamport: number;
  tombstones: number;
  lastSeq: number;
  live: boolean;
}> {
  const state = await loadScore(scoreId);
  const stable = await query<{ stable: number | null }>(
    `select min(acked_lamport) as stable from collaborators
     where score_id = $1 and status = 'active'`,
    [scoreId],
  );
  const tombstones = await query<{ count: string }>(
    'select count(*) as count from elements where score_id = $1 and delete_lamport is not null',
    [scoreId],
  );
  return {
    lamport: state.head.lamport,
    stableLamport: stable[0]?.stable ?? 0,
    tombstones: Number(tombstones[0]?.count ?? 0),
    lastSeq: state.head.lastSeq,
    live: broadcast.live,
  };
}
