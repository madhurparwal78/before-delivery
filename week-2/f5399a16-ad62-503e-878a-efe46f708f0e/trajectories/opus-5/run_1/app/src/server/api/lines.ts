import { randomUUID } from 'node:crypto';
import { COPY } from '../../domain/copy.js';
import { LANGUAGES } from '../../domain/privateCopy.js';
import { readingTimeProblem, safeAreaProblem } from '../../domain/rules.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import {
  addEvent,
  readFrames,
  requireJob,
  requireWritableJob,
} from './support.js';
import type { FrameRow, JobRow } from './support.js';

type LineRow = {
  id: string;
  job_id: string;
  frame: number;
  market: string;
  text: string;
  x: string;
  y: string;
  width: string;
  height: string;
  clips: number;
};

function lineJson(line: LineRow): Record<string, unknown> {
  return {
    id: line.id,
    frame: line.frame,
    market: line.market,
    text: line.text,
    x: Number(line.x),
    y: Number(line.y),
    width: Number(line.width),
    height: Number(line.height),
    clips: line.clips,
  };
}

type LineValues = {
  frame: number;
  market: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  clips: number;
};

/** The safe area is judged before reading time, and both answer 422. */
function judge(values: LineValues, job: JobRow, frames: readonly FrameRow[]): void {
  if (values.text.trim() === '') throw refuse.fields({ text: COPY.lineText });
  const start = frames.findIndex((frame) => frame.number === values.frame);
  if (start === -1) throw refuse.notFound();
  if (start + values.clips > frames.length) throw refuse.value(COPY.linePastLast);
  const outside = safeAreaProblem(values);
  if (outside !== null) throw refuse.value(outside);
  const onScreen = frames
    .slice(start, start + values.clips)
    .reduce((sum, frame) => sum + frame.duration_frames, 0);
  const reading = readingTimeProblem(values.text, onScreen, job.frame_rate);
  if (reading !== null) throw refuse.value(reading);
}

function readValues(
  body: Record<string, unknown>,
  fallback: LineValues | null,
): LineValues {
  const fields = new FieldCollector();
  const values: LineValues = {
    frame:
      'frame' in body || fallback === null
        ? fields.wholeNumber(body, 'frame', 1, 10_000_000)
        : fallback.frame,
    market:
      'market' in body || fallback === null
        ? fields.choice(body, 'market', LANGUAGES)
        : fallback.market,
    text:
      'text' in body || fallback === null
        ? fields.optionalText(body, 'text')
        : fallback.text,
    x: 'x' in body || fallback === null ? fields.percent(body, 'x') : fallback.x,
    y: 'y' in body || fallback === null ? fields.percent(body, 'y') : fallback.y,
    width:
      'width' in body || fallback === null ? fields.percent(body, 'width') : fallback.width,
    height:
      'height' in body || fallback === null ? fields.percent(body, 'height') : fallback.height,
    clips:
      'clips' in body
        ? fields.wholeNumber(body, 'clips', 1, 10_000)
        : (fallback?.clips ?? 1),
  };
  fields.done();
  return values;
}

async function lineOf(deskId: string, lineId: string): Promise<{ line: LineRow; job: JobRow }> {
  const line = await one<LineRow>(
    `select l.* from lines l join jobs j on j.id = l.job_id
       join clients c on c.id = j.client_id
      where l.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
    [lineId, deskId],
  );
  if (!line) throw refuse.notFound();
  return { line, job: await requireJob(deskId, line.job_id) };
}

export const lineRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/lines',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const market = context.query.get('market');
      const lines = await query<LineRow>(
        `select * from lines where job_id = $1 and ($2::text is null or market = $2)
          order by created_at asc, id asc`,
        [job.id, market],
      );
      return { status: 200, body: { lines: lines.map(lineJson) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/lines',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const values = readValues(body, null);
      requireWritableJob(job);
      judge(values, job, await readFrames(job.id));
      const id = randomUUID();
      await query(
        `insert into lines (id, job_id, frame, market, text, x, y, width, height, clips, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
        [
          id,
          job.id,
          values.frame,
          values.market,
          values.text,
          values.x,
          values.y,
          values.width,
          values.height,
          values.clips,
        ],
      );
      await addEvent(job.id, desk.name, 'lineSaved', COPY.lineSaved);
      const made = await one<LineRow>('select * from lines where id = $1', [id]);
      return { status: 201, body: lineJson(made as LineRow) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/lines/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { line, job } = await lineOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const values = readValues(body, {
        frame: line.frame,
        market: line.market,
        text: line.text,
        x: Number(line.x),
        y: Number(line.y),
        width: Number(line.width),
        height: Number(line.height),
        clips: line.clips,
      });
      requireWritableJob(job);
      judge(values, job, await readFrames(job.id));
      await query(
        `update lines set frame = $1, market = $2, text = $3, x = $4, y = $5,
                          width = $6, height = $7, clips = $8 where id = $9`,
        [
          values.frame,
          values.market,
          values.text,
          values.x,
          values.y,
          values.width,
          values.height,
          values.clips,
          line.id,
        ],
      );
      await addEvent(job.id, desk.name, 'lineSaved', COPY.lineSaved);
      const saved = await one<LineRow>('select * from lines where id = $1', [line.id]);
      return { status: 200, body: lineJson(saved as LineRow) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/lines/:id',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { line, job } = await lineOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      requireWritableJob(job);
      await query('delete from lines where id = $1', [line.id]);
      await addEvent(job.id, desk.name, 'lineRemoved', COPY.lineRemoved);
      return { status: 204 };
    },
  },
];
