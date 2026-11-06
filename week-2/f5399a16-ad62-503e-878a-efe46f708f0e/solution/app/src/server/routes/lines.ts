import { randomUUID } from 'node:crypto';
import { COPY, fill, LANGUAGES, type Language } from '../../shared/copy';
import { divHalfUp, readingFrames, roundToTenth, type FrameRate } from '../../shared/timecode';
import { addHistory, assertJobWritable, boardFrames, jobOfDesk, loadJob } from '../records';
import { one, pool, rows, type Row } from '../db';
import { invalid, isUuid, noContent, notFound, ok, refused, route, type Context } from '../http';


function lineJson(line: Row): Row {
  return { id: line.id, frame: line.frame, market: line.market, text: line.text, x: line.x, y: line.y, width: line.width, height: line.height, clips: line.clips };
}

/** Thousandths of a percent, half up to one decimal: `3.5`, `11.0`. */
function percentText(distance: number): string {
  const tenths = divHalfUp(Math.round(distance * 1000), 100);
  return `${(tenths - (tenths % 10)) / 10}.${tenths % 10}`;
}

interface LineValues {
  frame: number;
  market: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  clips: number;
}

async function judgeLine(job: Row, values: Record<string, unknown>): Promise<LineValues> {
  if (typeof values.text !== 'string' || values.text.trim() === '') throw invalid({ text: COPY.lineText });
  if (typeof values.market !== 'string' || !LANGUAGES.includes(values.market as Language)) throw invalid({ market: 'Pick a market.' });
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof values[key] !== 'number' || !Number.isFinite(values[key])) throw invalid({ [key]: `Type a percent for ${key}.` });
  }
  for (const key of ['width', 'height']) {
    if ((values[key] as number) <= 0) throw invalid({ [key]: `Type a percent for ${key}.` });
  }
  const clips = values.clips ?? 1;
  if (!Number.isInteger(clips) || (clips as number) < 1) throw invalid({ clips: 'Type a whole number of clips.' });
  const { x, y, width, height } = values as unknown as LineValues;
  const frames = await boardFrames(pool, job.id);
  const index = frames.findIndex((frame) => frame.number === values.frame);
  if (index < 0) throw notFound();

  const outside = Math.max(5 - x, 5 - y, x + width - 95, y + height - 95);
  if (outside > 0) throw invalid({ x: fill(COPY.lineOutside, { percent: percentText(outside) }) });
  const spanned = frames.slice(index, index + (clips as number));
  if (spanned.length < (clips as number)) throw refused(COPY.linePastEnd);
  const has = spanned.reduce((sum, frame) => sum + (frame.duration_frames as number), 0);
  const words = values.text.trim().split(/\s+/).length;
  const needs = readingFrames(words, job.frame_rate as FrameRate);
  if (needs > has) throw refused(fill(COPY.lineReading, { count: needs, has }));
  return { frame: values.frame as number, market: values.market, text: values.text, x: roundToTenth(x), y: roundToTenth(y), width: roundToTenth(width), height: roundToTenth(height), clips: clips as number };
}

route('GET', '/api/jobs/:id/lines', { load: loadJob }, async ({ found, query }) => {
  const market = query.get('market');
  const lines = market
    ? await rows(pool, 'SELECT * FROM lines WHERE job_id = $1 AND market = $2 ORDER BY seq', [found.id, market])
    : await rows(pool, 'SELECT * FROM lines WHERE job_id = $1 ORDER BY seq', [found.id]);
  return ok({ lines: lines.map(lineJson) });
});

route('POST', '/api/jobs/:id/lines', { load: loadJob }, async ({ found, body, desk, now }) => {
  const values = await judgeLine(found, body);
  assertJobWritable(found);
  const line = await one(
    pool,
    `INSERT INTO lines (id, job_id, frame, market, text, x, y, width, height, clips) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [randomUUID(), found.id, values.frame, values.market, values.text, values.x, values.y, values.width, values.height, values.clips],
  );
  await addHistory(pool, found.id, desk.name, 'lineSaved', COPY.lineSaved, now);
  return ok(lineJson(line as Row), 201);
});

async function loadLine(context: Context): Promise<{ line: Row; job: Row }> {
  if (!isUuid(context.params.id)) throw notFound();
  const line = await one(pool, 'SELECT l.* FROM lines l JOIN jobs j ON j.id = l.job_id WHERE l.id = $1 AND j.desk_id = $2', [context.params.id, context.desk.id]);
  if (!line) throw notFound();
  return { line, job: await jobOfDesk(pool, line.job_id, context.desk.id) };
}

route('PATCH', '/api/lines/:id', { load: loadLine }, async ({ found, body, desk, now }) => {
  const values = await judgeLine(found.job, { ...lineJson(found.line), ...body });
  assertJobWritable(found.job);
  const line = await one(
    pool,
    'UPDATE lines SET frame = $1, market = $2, text = $3, x = $4, y = $5, width = $6, height = $7, clips = $8 WHERE id = $9 RETURNING *',
    [values.frame, values.market, values.text, values.x, values.y, values.width, values.height, values.clips, found.line.id],
  );
  await addHistory(pool, found.job.id, desk.name, 'lineSaved', COPY.lineSaved, now);
  return ok(lineJson(line as Row));
});

route('DELETE', '/api/lines/:id', { load: loadLine }, async ({ found, desk, now }) => {
  assertJobWritable(found.job);
  await pool.query('DELETE FROM lines WHERE id = $1', [found.line.id]);
  await addHistory(pool, found.job.id, desk.name, 'lineRemoved', COPY.lineRemoved, now);
  return noContent();
});
