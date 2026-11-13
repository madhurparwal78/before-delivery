import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Clef, SetField, Staff, Transpose, Voice } from '../../shared/types.js';
import { MAX_MEASURES, MAX_STAVES, transposePitch } from '../../shared/music.js';
import { config } from '../config.js';
import { query, transact } from '../db/pool.js';
import { hub } from '../live/hub.js';
import { decodeCursor, engrave, systemsPage } from '../engrave/service.js';
import { errors } from '../errors.js';
import type { HttpApp } from '../http/server.js';
import {
  FieldCollector,
  asRecord,
  queryNumber,
  trimmedName,
  wholeNumber,
} from '../http/validate.js';
import { broadcast } from '../services/valkey.js';
import { collaboratorOf } from '../store/collaborators.js';
import { requireHolds } from '../store/holds.js';
import { decodeHistoryCursor, readHistory } from '../store/history.js';
import { syncState } from '../store/ops.js';
import { loadScore, loadVoices, voiceOf } from '../store/score.js';

const CLEFS: Clef[] = ['treble', 'alto', 'tenor', 'bass', 'percussion'];
const SET_FIELDS: SetField[] = [
  'pitch',
  'duration',
  'dots',
  'tie',
  'dynamic',
  'dynamicPlacement',
  'text',
];

function transposeOf(value: unknown): Transpose | null {
  const record = asRecord(value);
  const diatonic = wholeNumber(record.diatonic, -24, 24);
  const chromatic = wholeNumber(record.chromatic, -48, 48);
  if (diatonic === null || chromatic === null) return null;
  return { diatonic, chromatic };
}

function staffNames(staves: Staff[]): Map<string, string> {
  return new Map(staves.map((staff) => [staff.id, staff.name]));
}

export function registerScoreRoutes(app: HttpApp): void {
  app.add({
    method: 'GET',
    path: '/api/health',
    auth: 'open',
    handler: async () => ({ json: { status: 'ok' } }),
  });

  app.add({
    method: 'GET',
    path: '/api/me',
    auth: 'seat',
    handler: async ({ caller }) => {
      const state = await loadScore(caller.score_id);
      return {
        json: {
          collaborator: collaboratorOf(
            caller,
            state.staves.map((staff) => staff.id),
          ),
          score: { id: state.head.id, title: state.head.title },
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId',
    auth: 'seat',
    handler: async ({ params }) => {
      const state = await loadScore(params.scoreId!);
      return { json: { score: state.head } };
    },
  });

  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/staves',
    auth: 'seat',
    roles: ['composer'],
    handler: async ({ params, body }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const record = asRecord(body);
      const problems = new FieldCollector();
      const { name, problem } = trimmedName(record.name, 40);
      if (problem) problems.add('name', 'Use 1 to 40 characters.');
      if (typeof record.clef !== 'string' || !CLEFS.includes(record.clef as Clef)) {
        problems.add('clef', 'Choose a clef.');
      }
      const transpose = transposeOf(record.transpose);
      if (!transpose) problems.add('transpose', 'Choose a transposition.');
      const partId = record.partId ?? null;
      if (partId !== null && typeof partId !== 'string') problems.add('partId', 'Unknown part.');
      if (
        typeof partId === 'string' &&
        !state.parts.some((part) => part.id === partId)
      ) {
        problems.add('partId', 'Unknown part.');
      }
      const afterStaffId = record.afterStaffId ?? null;
      if (afterStaffId !== null && typeof afterStaffId !== 'string') {
        problems.add('afterStaffId', 'Unknown staff.');
      }
      if (
        typeof afterStaffId === 'string' &&
        !state.staves.some((staff) => staff.id === afterStaffId)
      ) {
        problems.add('afterStaffId', 'Unknown staff.');
      }
      if (state.staves.length >= MAX_STAVES) {
        problems.add('staves', 'A score holds at most 64 staves.');
      }
      problems.throwIfFailed();

      const staffId = `st-${randomUUID().slice(0, 8)}`;
      const created = await transact(async (client) => {
        const order = await nextOrder(client, scoreId, afterStaffId as string | null);
        let targetPartId = partId as string | null;
        if (targetPartId === null) {
          targetPartId = `p-${randomUUID().slice(0, 8)}`;
          await client.query(
            `insert into parts (id, score_id, name, status, revision, layout, ord)
             values ($1, $2, $3, 'draft', 0, '{"systemBreaks":[],"pageBreaks":[]}'::jsonb,
               (select coalesce(max(ord), 0) + 1 from parts where score_id = $2))`,
            [targetPartId, scoreId, name],
          );
        }
        await client.query(
          `insert into staves (id, score_id, name, clef, transpose_diatonic, transpose_chromatic, part_id, ord)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            staffId,
            scoreId,
            name,
            record.clef,
            transpose!.diatonic,
            transpose!.chromatic,
            targetPartId,
            order,
          ],
        );
        return targetPartId;
      });
      const refreshed = await loadScore(scoreId);
      await broadcast.publish(scoreId, { type: 'score', score: refreshed.head });
      const staff = refreshed.staves.find((candidate) => candidate.id === staffId)!;
      const part = refreshed.head.parts.find((candidate) => candidate.id === created)!;
      return { status: 201, json: { staff, part } };
    },
  });

  app.add({
    method: 'PATCH',
    path: '/api/scores/:scoreId/staves/:staffId',
    auth: 'seat',
    roles: ['composer', 'copyist'],
    handler: async ({ params, body, caller }) => {
      const scoreId = params.scoreId!;
      const staffId = params.staffId!;
      const state = await loadScore(scoreId);
      const staff = state.staves.find((candidate) => candidate.id === staffId);
      if (!staff) throw errors.notFound();
      await requireHolds(scoreId, caller, [staffId], staffNames(state.staves));
      const record = asRecord(body);
      const problems = new FieldCollector();
      let name = staff.name;
      if (record.name !== undefined) {
        const trimmed = trimmedName(record.name, 40);
        if (trimmed.problem) problems.add('name', 'Use 1 to 40 characters.');
        name = trimmed.name;
      }
      let clef = staff.clef;
      if (record.clef !== undefined) {
        if (typeof record.clef !== 'string' || !CLEFS.includes(record.clef as Clef)) {
          problems.add('clef', 'Choose a clef.');
        } else {
          clef = record.clef as Clef;
        }
      }
      let transpose = staff.transpose;
      if (record.transpose !== undefined) {
        const parsed = transposeOf(record.transpose);
        if (!parsed) problems.add('transpose', 'Choose a transposition.');
        else transpose = parsed;
      }
      problems.throwIfFailed();
      await query(
        `update staves set name = $3, clef = $4, transpose_diatonic = $5, transpose_chromatic = $6
         where score_id = $1 and id = $2`,
        [scoreId, staffId, name, clef, transpose.diatonic, transpose.chromatic],
      );
      const refreshed = await loadScore(scoreId);
      await broadcast.publish(scoreId, { type: 'score', score: refreshed.head });
      return {
        json: { staff: refreshed.staves.find((candidate) => candidate.id === staffId)! },
      };
    },
  });

  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/measures',
    auth: 'seat',
    roles: ['composer'],
    handler: async ({ params, body }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const record = asRecord(body);
      const problems = new FieldCollector();
      const count = wholeNumber(record.count, 1, 2000);
      if (count === null) problems.add('count', 'Add 1 to 2,000 measures.');
      let beats: number | null = null;
      let beatType: number | null = null;
      if (record.timeSignature !== undefined && record.timeSignature !== null) {
        const signature = asRecord(record.timeSignature);
        beats = wholeNumber(signature.beats, 1, 16);
        beatType = wholeNumber(signature.beatType, 1, 16);
        if (beats === null || beatType === null || ![1, 2, 4, 8, 16].includes(beatType)) {
          problems.add('timeSignature', 'Choose a time signature.');
        }
      }
      if (count !== null && state.head.measureCount + count > MAX_MEASURES) {
        problems.add('measures', 'A score holds at most 2,000 measures.');
      }
      problems.throwIfFailed();
      const firstNew = state.head.measureCount + 1;
      await transact(async (client) => {
        if (beats !== null && beatType !== null) {
          await client.query(
            `insert into time_signatures (score_id, measure, beats, beat_type)
             values ($1, $2, $3, $4)
             on conflict (score_id, measure) do update set beats = excluded.beats, beat_type = excluded.beat_type`,
            [scoreId, firstNew, beats, beatType],
          );
        }
        await client.query('update scores set measure_count = measure_count + $2 where id = $1', [
          scoreId,
          count,
        ]);
      });
      const refreshed = await loadScore(scoreId);
      await broadcast.publish(scoreId, { type: 'score', score: refreshed.head });
      return {
        json: {
          measureCount: refreshed.head.measureCount,
          timeSignatures: refreshed.head.timeSignatures,
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/staves/:staffId/voices/:voice',
    auth: 'seat',
    handler: async ({ params, query: search }) => {
      const scoreId = params.scoreId!;
      const staffId = params.staffId!;
      const state = await loadScore(scoreId);
      const staff = state.staves.find((candidate) => candidate.id === staffId);
      if (!staff) throw errors.notFound();
      const voice = Number(params.voice);
      if (voice !== 1 && voice !== 2) throw errors.notFound();
      const wanted = search.get('pitch') ?? 'concert';
      if (wanted !== 'concert' && wanted !== 'written') {
        throw errors.validation({ pitch: 'Ask for concert or written pitch.' });
      }
      const voices = await loadVoices(scoreId, [staffId]);
      const events = voiceOf(voices, staffId, voice as Voice).events(state.meter);
      return {
        json: {
          staffId,
          voice,
          events: events.map((event) => ({
            ...event,
            pitch:
              event.pitch === null || wanted === 'concert'
                ? event.pitch
                : transposePitch(event.pitch, staff.transpose, -1),
          })),
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/engraving',
    auth: 'seat',
    handler: async ({ params, query: search }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const view = search.get('view') === 'part' ? 'part' : 'score';
      const problems = new FieldCollector();
      const limit = queryNumber(search.get('limit'), 8);
      if (limit === null || limit < 1 || limit > 16) {
        problems.add('limit', 'Ask for 1 to 16 systems.');
      }
      const partId = search.get('partId');
      if (view === 'part' && (partId === null || !state.parts.some((part) => part.id === partId))) {
        problems.add('partId', 'Choose a part.');
      }
      const rawCursor = search.get('cursor');
      const cursor = rawCursor === null ? 0 : decodeCursor(rawCursor);
      if (cursor === null) problems.add('cursor', 'Unknown cursor.');
      problems.throwIfFailed();
      const result = await engrave({
        scoreId,
        view,
        partId: view === 'part' ? partId : null,
      });
      const page = systemsPage(result, cursor!, limit!);
      return {
        json: {
          view,
          partId: view === 'part' ? partId : null,
          lamport: result.lamport,
          systems: page.systems,
          nextCursor: page.nextCursor,
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/history',
    auth: 'seat',
    handler: async ({ params, query: search }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const problems = new FieldCollector();
      const limit = queryNumber(search.get('limit'), 50);
      if (limit === null || limit < 1 || limit > 100) {
        problems.add('limit', 'Ask for 1 to 100 entries.');
      }
      const rawCursor = search.get('before');
      const before = rawCursor === null ? undefined : decodeHistoryCursor(rawCursor);
      if (before === null) problems.add('before', 'Unknown cursor.');
      const staffId = search.get('staffId') ?? undefined;
      if (staffId !== undefined && !state.staves.some((staff) => staff.id === staffId)) {
        problems.add('staffId', 'Unknown staff.');
      }
      const rawType = search.get('type');
      if (rawType !== null && !['insert', 'delete', 'set'].includes(rawType)) {
        problems.add('type', 'Unknown filter.');
      }
      const rawField = search.get('field');
      const fields = rawField === null ? undefined : rawField.split(',');
      if (fields && fields.some((field) => !SET_FIELDS.includes(field as SetField))) {
        problems.add('field', 'Unknown filter.');
      }
      problems.throwIfFailed();
      const page = await readHistory(scoreId, {
        limit: limit!,
        ...(typeof before === 'number' ? { before } : {}),
        ...(staffId !== undefined ? { staffId } : {}),
        ...(rawType !== null ? { type: rawType as 'insert' | 'delete' | 'set' } : {}),
        ...(fields ? { fields: fields as SetField[] } : {}),
      });
      return { json: page };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/presence',
    auth: 'seat',
    handler: async ({ params }) => ({
      json: {
        entries: await hub.presenceOf(params.scoreId!),
        ttlSeconds: config.awarenessTtlSeconds,
      },
    }),
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/sync',
    auth: 'seat',
    handler: async ({ params }) => ({ json: await syncState(params.scoreId!) }),
  });
}

async function nextOrder(
  client: PoolClient,
  scoreId: string,
  afterStaffId: string | null,
): Promise<number> {
  if (afterStaffId === null) {
    const last = await client.query<{ ord: number | null }>(
      'select max(ord) as ord from staves where score_id = $1',
      [scoreId],
    );
    return (last.rows[0]?.ord ?? 0) + 1;
  }
  const anchor = await client.query<{ ord: number }>(
    'select ord from staves where score_id = $1 and id = $2',
    [scoreId, afterStaffId],
  );
  const after = anchor.rows[0]!.ord;
  const following = await client.query<{ ord: number | null }>(
    'select min(ord) as ord from staves where score_id = $1 and ord > $2',
    [scoreId, after],
  );
  const next = following.rows[0]?.ord;
  return next === null || next === undefined ? after + 1 : (after + next) / 2;
}
