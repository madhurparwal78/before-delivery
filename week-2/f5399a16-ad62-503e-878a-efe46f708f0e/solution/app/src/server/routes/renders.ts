import { randomUUID, createHash } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { clockRoundedUp, instantText, TOWN_ZONES } from '../../shared/time';
import { addHistory, assertJobWritable, roundedNow, boardFrames, cutOfJob, instant, loadJob, type CutFrame } from '../records';
import { one, pool, rows, type Row } from '../db';
import { isUuid, notFound, ok, route, unavailable } from '../http';
import { askForRender, fetchFilm, pollRender } from '../providers';
import { getObject, objectKeys, putObject, storeDown, StoreFailure } from '../s3';
import { checkOneOf, checkWhole, throwIfAny, type Fields } from '../validate';

const POLL_GAP_MS = 5000;

/** A busy answer holds every call to the service until its instant, on every path. */
async function busyUntil(now: number): Promise<number | null> {
  const row = await one(pool, `SELECT value FROM meta WHERE key = 'renderBusyUntil'`);
  const until = row ? Number(row.value) : 0;
  return until > now ? until : null;
}

async function holdService(until: number): Promise<void> {
  await pool.query(`INSERT INTO meta (key, value) VALUES ('renderBusyUntil', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [String(until)]);
}

function busyCopy(until: number): string {
  return fill(COPY.renderBusy, { time: clockRoundedUp(until, TOWN_ZONES.amsterdam) });
}

function sameFrames(board: Row[], frames: CutFrame[]): boolean {
  const ordered = [...frames].sort((a, b) => a.position - b.position);
  return (
    board.length === ordered.length &&
    board.every((frame, index) => {
      const kept = ordered[index] as CutFrame;
      return frame.number === kept.number && frame.duration_frames === kept.durationFrames && frame.sha256 === kept.sha256;
    })
  );
}

function renderJson(jobId: string, render: Row, board: Row[], cuts: Map<number, CutFrame[]>): Row {
  const frames = cuts.get(render.cut);
  const outdated = render.state === 'ready' && (frames === undefined || !sameFrames(board, frames));
  return {
    id: render.id,
    cut: render.cut,
    width: render.width,
    burnTimecode: render.burn_timecode,
    state: outdated ? 'outdated' : render.state,
    progress: render.progress,
    message: render.message,
    size: render.size,
    sha256: render.sha256,
    filmUrl: render.state === 'ready' ? `/api/jobs/${jobId}/renders/${render.id}/film` : null,
    createdAt: instant(render.created_at),
  };
}

async function rendersOf(jobId: string, list: Row[]): Promise<Row[]> {
  const board = await boardFrames(pool, jobId);
  const cuts = new Map((await rows(pool, 'SELECT number, frames FROM cuts WHERE job_id = $1', [jobId])).map((cut) => [cut.number as number, cut.frames as CutFrame[]]));
  return list.map((render) => renderJson(jobId, render, board, cuts));
}

route('GET', '/api/jobs/:id/renders', { load: loadJob }, async ({ found, now }) => {
  const list = await rows(pool, 'SELECT * FROM renders WHERE job_id = $1 ORDER BY created_at, id', [found.id]);
  const until = await busyUntil(now);
  return ok({ renders: await rendersOf(found.id, list), busy: until ? { until: instantText(until), message: busyCopy(until) } : null });
});

route('POST', '/api/jobs/:id/renders', { load: loadJob }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const cutNumber = checkWhole(fields, 'cut', body.cut, 1, 'Pick a cut.');
  const width = checkOneOf(fields, 'width', body.width, [640, 1280], 'Pick a width.');
  if (typeof body.burnTimecode !== 'boolean') fields.burnTimecode = 'Say whether to burn in timecode.';
  throwIfAny(fields);
  const cut = await cutOfJob(pool, found.id, cutNumber);
  assertJobWritable(found);
  const burn = body.burnTimecode as boolean;
  const stored = async () => one(pool, `SELECT * FROM renders WHERE job_id = $1 AND cut = $2 AND width = $3 AND burn_timecode = $4 AND state <> 'failed'`, [found.id, cutNumber, width, burn]);
  const answerStored = async (render: Row) => ok((await rendersOf(found.id, [render]))[0]);
  const existing = await stored();
  if (existing) return answerStored(existing);
  const until = await busyUntil(now);
  if (until) throw unavailable(busyCopy(until));

  const id = randomUUID();
  const inserted = await one(
    pool,
    `INSERT INTO renders (id, job_id, cut, width, burn_timecode, state, created_at) VALUES ($1, $2, $3, $4, $5, 'queued', $6)
     ON CONFLICT (job_id, cut, width, burn_timecode) WHERE state <> 'failed' DO NOTHING RETURNING *`,
    [id, found.id, cutNumber, width, burn, new Date(roundedNow(now))],
  );
  if (!inserted) return answerStored((await stored()) as Row);

  const asked = await askForRender({
    cutId: cut.id,
    frameRate: cut.frame_rate,
    width,
    burnTimecode: burn,
    clips: [...(cut.frames as CutFrame[])].sort((a, b) => a.position - b.position).map((frame) => ({ frame: frame.number, durationFrames: frame.durationFrames, sha256: frame.sha256 })),
  });
  if (asked.kind !== 'started') {
    await pool.query('DELETE FROM renders WHERE id = $1', [id]);
    if (asked.kind === 'busy') {
      const hold = now + asked.retryAfterSeconds * 1000;
      await holdService(hold);
      throw unavailable(busyCopy(hold));
    }
    throw unavailable(COPY.renderDown);
  }
  const render = await one(pool, 'UPDATE renders SET provider_id = $1, next_poll_at = $2 WHERE id = $3 RETURNING *', [asked.providerId, new Date(Date.now() + 1000), id]);
  await addHistory(pool, found.id, desk.name, 'filmAsked', COPY.filmAsked, now);
  return ok((await rendersOf(found.id, [render as Row]))[0], 202);
});

route(
  'GET',
  '/api/jobs/:id/renders/:render/film',
  {
    load: async (context) => {
      const job = await loadJob(context);
      if (!isUuid(context.params.render)) throw notFound();
      const render = await one(pool, `SELECT * FROM renders WHERE id = $1 AND job_id = $2 AND state = 'ready'`, [context.params.render, job.id]);
      if (!render) throw notFound();
      return { job, render };
    },
  },
  async ({ found }) => {
    try {
      const data = await getObject(objectKeys(found.job.client_id, found.job.id).film(found.render.id));
      return { status: 200, bytes: { data, type: 'application/octet-stream', fileName: `film-cut-${found.render.cut}.bin` } };
    } catch (error) {
      if (error instanceof StoreFailure) throw storeDown();
      throw error;
    }
  },
);

async function finishRender(render: Row, poll: { url: string; size: number; sha256: string }): Promise<void> {
  await pool.query(`UPDATE renders SET state = 'done', progress = 100 WHERE id = $1`, [render.id]);
  const film = await fetchFilm(poll.url);
  if (film === null) {
    await pool.query('UPDATE renders SET next_poll_at = $1 WHERE id = $2', [new Date(Date.now() + POLL_GAP_MS), render.id]);
    return;
  }
  const failed = (message: string) => pool.query(`UPDATE renders SET state = 'failed', message = $1, next_poll_at = NULL WHERE id = $2`, [message, render.id]);
  if (film.length !== poll.size || createHash('sha256').update(film).digest('hex') !== poll.sha256) {
    await failed(COPY.renderIncomplete);
    return;
  }
  try {
    await putObject(objectKeys(render.client_id, render.job_id).film(render.id), film, 'application/octet-stream');
  } catch (error) {
    if (!(error instanceof StoreFailure)) throw error;
    await failed(COPY.storeDown);
    return;
  }
  await pool.query(`UPDATE renders SET state = 'ready', size = $1, sha256 = $2, next_poll_at = NULL WHERE id = $3`, [film.length, poll.sha256, render.id]);
}

/** The server does the polling, so a render finishes with no screen open and after a restart. */
export async function pollRenders(): Promise<void> {
  const now = Date.now();
  if (await busyUntil(now)) return;
  const due = await rows(
    pool,
    `SELECT r.*, j.client_id FROM renders r JOIN jobs j ON j.id = r.job_id
     WHERE r.state IN ('queued', 'running', 'done') AND r.provider_id IS NOT NULL AND r.next_poll_at <= $1 ORDER BY r.next_poll_at`,
    [new Date(now)],
  );
  for (const render of due) {
    await pool.query('UPDATE renders SET next_poll_at = $1 WHERE id = $2', [new Date(Date.now() + POLL_GAP_MS), render.id]);
    const poll = await pollRender(render.provider_id);
    if (poll.kind === 'busy') {
      await holdService(Date.now() + poll.retryAfterSeconds * 1000);
      return;
    }
    if (poll.kind === 'working') await pool.query('UPDATE renders SET state = $1, progress = $2 WHERE id = $3', [poll.state, poll.progress, render.id]);
    if (poll.kind === 'failed') await pool.query(`UPDATE renders SET state = 'failed', message = $1, next_poll_at = NULL WHERE id = $2`, [COPY.renderFailed, render.id]);
    if (poll.kind === 'done') await finishRender(render, poll);
  }
}
