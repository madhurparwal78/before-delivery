import { randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { differences } from '../../domain/rules.js';
import type { CutFrame } from '../../domain/rules.js';
import { timecode } from '../../domain/timecode.js';
import type { FrameRate } from '../../domain/timecode.js';
import { toInstantText } from '../../domain/time.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { FieldCollector, requireNumberParam, requireUuidParam } from '../validate.js';
import {
  addEvent,
  bumpStamp,
  readBoard,
  readFrames,
  requireJob,
  requireStamp,
  requireWritableJob,
} from './support.js';
import type { JobRow } from './support.js';

export type CutRow = {
  id: string;
  job_id: string;
  number: number;
  name: string;
  frame_rate: FrameRate;
  signed_off_at: Date | null;
  signed_off_by: string | null;
  signed_off_producer_id: string | null;
  created_at: Date;
};

export type CutFrameRow = {
  id: string;
  cut_id: string;
  number: number;
  position: number;
  duration_frames: number;
  action_note: string;
  audio_note: string;
  shot: string;
  visual: string;
  file_name: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawing_kind: string | null;
};

export function cutJson(cut: CutRow): Record<string, unknown> {
  return {
    id: cut.id,
    number: cut.number,
    name: cut.name,
    frameRate: cut.frame_rate,
    createdAt: toInstantText(cut.created_at),
    signedOffAt: cut.signed_off_at === null ? null : toInstantText(cut.signed_off_at),
    signedOffBy: cut.signed_off_by,
  };
}

export async function readCutFrames(cutId: string): Promise<CutFrameRow[]> {
  return query<CutFrameRow>(
    'select * from cut_frames where cut_id = $1 order by position asc, number asc',
    [cutId],
  );
}

export async function findCut(jobId: string, number: number): Promise<CutRow | null> {
  return one<CutRow>('select * from cuts where job_id = $1 and number = $2', [jobId, number]);
}

export async function requireCut(jobId: string, number: number): Promise<CutRow> {
  const cut = await findCut(jobId, number);
  if (!cut) throw refuse.notFound();
  return cut;
}

export function cutFrameJson(
  jobId: string,
  cut: CutRow,
  frames: readonly CutFrameRow[],
): Record<string, unknown>[] {
  let running = 0;
  return frames.map((frame) => {
    const timecodeIn = timecode(running, cut.frame_rate);
    running += frame.duration_frames;
    return {
      number: frame.number,
      position: frame.position,
      durationFrames: frame.duration_frames,
      timecodeIn,
      actionNote: frame.action_note,
      audioNote: frame.audio_note,
      shot: frame.shot,
      visual: frame.visual,
      sha256: frame.drawing_kind === null ? null : frame.sha256,
      drawingUrl:
        frame.drawing_kind === null ? null : `/api/jobs/${jobId}/frames/${frame.number}/drawing`,
    };
  });
}

/** Make cut keeps the board exactly as `Cut <number>` with a name. */
export async function makeCut(job: JobRow, name: string, actor: string): Promise<CutRow> {
  const numbered = await one<{ next_cut_number: number }>(
    `update jobs set next_cut_number = next_cut_number + 1 where id = $1
       returning next_cut_number - 1 as next_cut_number`,
    [job.id],
  );
  const number = numbered?.next_cut_number ?? 1;
  const id = randomUUID();
  await query(
    `insert into cuts (id, job_id, number, name, frame_rate, created_at)
     values ($1,$2,$3,$4,$5,now())`,
    [id, job.id, number, name, job.frame_rate],
  );
  for (const frame of await readFrames(job.id)) {
    await query(
      `insert into cut_frames (id, cut_id, number, position, duration_frames, action_note,
                               audio_note, shot, visual, file_name, width, height, sha256,
                               drawing_kind)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        randomUUID(),
        id,
        frame.number,
        frame.position,
        frame.duration_frames,
        frame.action_note,
        frame.audio_note,
        frame.shot,
        frame.visual,
        frame.file_name,
        frame.width,
        frame.height,
        frame.sha256,
        frame.drawing_kind,
      ],
    );
  }
  await addEvent(job.id, actor, 'cutMade', say.cutMade(number));
  return (await findCut(job.id, number)) as CutRow;
}

export function toCutFrames(
  frames: readonly { number: number; position: number; duration_frames: number; sha256: string | null; drawing_kind: string | null }[],
): CutFrame[] {
  return frames.map((frame) => ({
    number: frame.number,
    position: frame.position,
    durationFrames: frame.duration_frames,
    sha256: frame.drawing_kind === null ? null : frame.sha256,
  }));
}

/** The newest cut of a job, used to read a note's position. */
export async function newestCut(jobId: string): Promise<CutRow | null> {
  return one<CutRow>('select * from cuts where job_id = $1 order by number desc limit 1', [
    jobId,
  ]);
}

export const cutRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/cuts',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cuts = await query<CutRow>(
        'select * from cuts where job_id = $1 order by number asc',
        [job.id],
      );
      return { status: 200, body: { cuts: cuts.map(cutJson) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/cuts',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeTitle);
      fields.done();
      requireWritableJob(job);
      return { status: 201, body: cutJson(await makeCut(job, name, desk.name)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/cuts/:number',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cut = await requireCut(job.id, requireNumberParam(context.params['number'] ?? ''));
      return {
        status: 200,
        body: {
          ...cutJson(cut),
          frames: cutFrameJson(job.id, cut, await readCutFrames(cut.id)),
        },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/jobs/:id/cuts/:number',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cut = await requireCut(job.id, requireNumberParam(context.params['number'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeTitle);
      fields.done();
      requireWritableJob(job);
      if (cut.signed_off_at !== null) throw refuse.state(COPY.cutSignedOff);
      await query('update cuts set name = $1 where id = $2', [name, cut.id]);
      await addEvent(job.id, desk.name, 'cutSaved', say.cutSaved(cut.number));
      return { status: 200, body: cutJson((await findCut(job.id, cut.number)) as CutRow) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/jobs/:id/cuts/:number',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cut = await requireCut(job.id, requireNumberParam(context.params['number'] ?? ''));
      requireWritableJob(job);
      if (cut.signed_off_at !== null) throw refuse.state(COPY.cutSignedOff);
      await query('delete from cuts where id = $1', [cut.id]);
      await addEvent(job.id, desk.name, 'cutDeleted', say.cutDeleted(cut.number));
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/cuts/:number/bring-back',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cut = await requireCut(job.id, requireNumberParam(context.params['number'] ?? ''));
      const body = await readJsonBody(context);
      requireWritableJob(job);
      requireStamp(job, body);
      const frames = await readCutFrames(cut.id);
      await query('delete from frames where job_id = $1', [job.id]);
      await query('delete from removals where job_id = $1', [job.id]);
      for (const frame of frames) {
        await query(
          `insert into frames (id, job_id, number, position, duration_frames, action_note,
                               audio_note, shot, visual, file_name, width, height, sha256,
                               drawing_kind, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
          [
            randomUUID(),
            job.id,
            frame.number,
            frame.position,
            frame.duration_frames,
            frame.action_note,
            frame.audio_note,
            frame.shot,
            frame.visual,
            frame.file_name,
            frame.width,
            frame.height,
            frame.sha256,
            frame.drawing_kind,
          ],
        );
      }
      await query('update jobs set frame_rate = $1 where id = $2', [cut.frame_rate, job.id]);
      await bumpStamp(job.id);
      await addEvent(job.id, desk.name, 'cutBroughtBack', say.cutBroughtBack(cut.number));
      return { status: 200, body: await readBoard(await requireJob(desk.id, job.id)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/compare',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const first = requireNumberParam(context.query.get('a') ?? '');
      const second = requireNumberParam(context.query.get('b') ?? '');
      const lower = await requireCut(job.id, Math.min(first, second));
      const higher = await requireCut(job.id, Math.max(first, second));
      const olderFrames = await readCutFrames(lower.id);
      const newerFrames = await readCutFrames(higher.id);
      return {
        status: 200,
        body: {
          differences: differences(toCutFrames(olderFrames), toCutFrames(newerFrames)),
          a: {
            ...cutJson(lower),
            frames: cutFrameJson(job.id, lower, olderFrames),
          },
          b: {
            ...cutJson(higher),
            frames: cutFrameJson(job.id, higher, newerFrames),
          },
        },
      };
    },
  },
];
