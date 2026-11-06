import { createHash, randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { clockTimeIn, toInstantText } from '../../domain/time.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import {
  askForRender,
  downloadFilm,
  ProviderBusy,
  ProviderDown,
  readRender,
} from '../infra/providers.js';
import { objectExists, putObject, StoreDown, storeKeys } from '../infra/store.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { readCutFrames, requireCut, toCutFrames } from './cuts.js';
import { readStored } from './drawings.js';
import { addEvent, readFrames, requireJob, requireWritableJob } from './support.js';
import type { JobRow } from './support.js';

const RENDER_SERVICE = 'quaymill';
const WIDTHS = [640, 1280] as const;

export type RenderRow = {
  id: string;
  job_id: string;
  cut_number: number;
  width: number;
  burn_timecode: boolean;
  state: string;
  progress: number;
  message: string | null;
  size: number | null;
  sha256: string | null;
  provider_id: string | null;
  polled_at: Date | null;
  created_at: Date;
};

/** A busy answer holds every call to the service until that instant, on every path. */
export async function busyUntil(): Promise<Date | null> {
  const row = await one<{ until: Date }>(
    'select until from provider_busy where service = $1 and until > now()',
    [RENDER_SERVICE],
  );
  return row?.until ?? null;
}

export async function noteBusy(seconds: number): Promise<Date> {
  const until = new Date(Math.floor(Date.now() / 1000) * 1000 + seconds * 1000);
  await query(
    `insert into provider_busy (service, until) values ($1,$2)
      on conflict (service) do update set until = greatest(provider_busy.until, $2)`,
    [RENDER_SERVICE, until],
  );
  return until;
}

/** A render shows `outdated` once the board's frames no longer equal its cut. */
export async function isOutdated(job: JobRow, cutNumber: number): Promise<boolean> {
  const cut = await one<{ id: string }>(
    'select id from cuts where job_id = $1 and number = $2',
    [job.id, cutNumber],
  );
  if (!cut) return true;
  const inCut = toCutFrames(await readCutFrames(cut.id));
  const onBoard = toCutFrames(await readFrames(job.id));
  if (inCut.length !== onBoard.length) return true;
  return inCut.some((frame, index) => {
    const other = onBoard[index];
    return (
      other === undefined ||
      other.number !== frame.number ||
      other.position !== frame.position ||
      other.durationFrames !== frame.durationFrames ||
      other.sha256 !== frame.sha256
    );
  });
}

export async function renderJson(
  job: JobRow,
  render: RenderRow,
): Promise<Record<string, unknown>> {
  const state =
    render.state === 'ready' && (await isOutdated(job, render.cut_number))
      ? 'outdated'
      : render.state;
  return {
    id: render.id,
    cut: render.cut_number,
    width: render.width,
    burnTimecode: render.burn_timecode,
    state,
    progress: render.progress,
    message: render.message,
    size: render.size,
    sha256: render.sha256,
    filmUrl:
      render.state === 'ready' ? `/api/jobs/${job.id}/renders/${render.id}/film` : null,
    createdAt: toInstantText(render.created_at),
  };
}

export const renderRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/renders',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const renders = await query<RenderRow>(
        'select * from renders where job_id = $1 order by created_at asc, id asc',
        [job.id],
      );
      const busy = await busyUntil();
      return {
        status: 200,
        body: {
          renders: await Promise.all(renders.map((render) => renderJson(job, render))),
          busy:
            busy === null
              ? null
              : {
                  until: toInstantText(busy),
                  message: say.renderBusy(clockTimeIn(busy, 'amsterdam')),
                },
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/renders',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const cutNumber = fields.wholeNumber(body, 'cut', 1, 10_000_000);
      const width = fields.numberChoice(body, 'width', WIDTHS);
      const burnTimecode =
        typeof body['burnTimecode'] === 'boolean' ? body['burnTimecode'] : false;
      fields.done();
      requireWritableJob(job);
      const cut = await requireCut(job.id, cutNumber);

      const stored = await one<RenderRow>(
        `select * from renders where job_id = $1 and cut_number = $2 and width = $3
           and burn_timecode = $4 and state <> 'failed' order by created_at desc limit 1`,
        [job.id, cutNumber, width, burnTimecode],
      );
      if (stored) return { status: 200, body: await renderJson(job, stored) };

      const busy = await busyUntil();
      if (busy !== null) {
        throw refuse.unavailable(say.renderBusy(clockTimeIn(busy, 'amsterdam')));
      }

      let providerId: string;
      try {
        providerId = await askForRender({
          cutId: cut.id,
          frameRate: cut.frame_rate,
          width,
          burnTimecode,
          clips: toCutFrames(await readCutFrames(cut.id)).map((frame) => ({
            frame: frame.number,
            durationFrames: frame.durationFrames,
            sha256: frame.sha256,
          })),
        });
      } catch (error) {
        if (error instanceof ProviderBusy) {
          const until = await noteBusy(error.retryAfterSeconds);
          throw refuse.unavailable(say.renderBusy(clockTimeIn(until, 'amsterdam')));
        }
        if (error instanceof ProviderDown) throw refuse.unavailable(COPY.renderUnavailable);
        throw error;
      }

      const id = randomUUID();
      await query(
        `insert into renders (id, job_id, cut_number, width, burn_timecode, state, provider_id,
                              created_at)
         values ($1,$2,$3,$4,$5,'queued',$6,now())`,
        [id, job.id, cutNumber, width, burnTimecode, providerId],
      );
      await addEvent(job.id, desk.name, 'filmAsked', COPY.filmAsked);
      const made = await one<RenderRow>('select * from renders where id = $1', [id]);
      return { status: 202, body: await renderJson(job, made as RenderRow) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/renders/:renderId/film',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const render = await one<RenderRow>(
        "select * from renders where id = $1 and job_id = $2 and state = 'ready'",
        [requireUuidParam(context.params['renderId'] ?? ''), job.id],
      );
      if (!render) throw refuse.notFound();
      const bytes = await readStored(storeKeys.film(job.client_id, job.id, render.id));
      return {
        status: 200,
        bytes,
        contentType: 'application/octet-stream',
        headers: { 'content-disposition': `attachment; filename="cut-${render.cut_number}.bin"` },
      };
    },
  },
];

/**
 * The server does the polling, so a render finishes with no screen open, and it
 * picks up unfinished renders after a restart. One render is polled at most
 * once per 5 seconds.
 */
export async function pollRenders(): Promise<void> {
  if ((await busyUntil()) !== null) return;
  const waiting = await query<RenderRow & { client_id: string }>(
    `select r.*, j.client_id from renders r join jobs j on j.id = r.job_id
      where r.state in ('queued','running','done')
        and (r.polled_at is null or r.polled_at < now() - interval '5 seconds')
      order by r.polled_at asc nulls first limit 4`,
    [],
  );
  for (const render of waiting) {
    await query('update renders set polled_at = now() where id = $1', [render.id]);
    await advance(render);
  }
}

async function advance(render: RenderRow & { client_id: string }): Promise<void> {
  if (render.provider_id === null) return;
  let progress: Awaited<ReturnType<typeof readRender>>;
  try {
    progress = await readRender(render.provider_id);
  } catch (error) {
    if (error instanceof ProviderBusy) await noteBusy(error.retryAfterSeconds);
    return;
  }
  if (progress.state === 'queued') return;
  if (progress.state === 'running') {
    await query("update renders set state = 'running', progress = $1 where id = $2", [
      progress.progress,
      render.id,
    ]);
    return;
  }
  if (progress.state === 'failed') {
    await query("update renders set state = 'failed', message = $1 where id = $2", [
      COPY.renderFailed,
      render.id,
    ]);
    return;
  }

  let film: Buffer;
  try {
    film = await downloadFilm(progress.url);
  } catch (error) {
    if (error instanceof ProviderBusy) await noteBusy(error.retryAfterSeconds);
    return;
  }
  const sha256 = createHash('sha256').update(film).digest('hex');
  if (film.length !== progress.size || sha256 !== progress.sha256) {
    await query("update renders set state = 'failed', message = $1 where id = $2", [
      COPY.renderIncomplete,
      render.id,
    ]);
    return;
  }
  const key = storeKeys.film(render.client_id, render.job_id, render.id);
  try {
    await putObject(key, film, 'application/octet-stream');
    if (!(await objectExists(key))) return;
  } catch (error) {
    if (error instanceof StoreDown) {
      await query("update renders set state = 'done', progress = 100 where id = $1", [render.id]);
      return;
    }
    throw error;
  }
  await query(
    "update renders set state = 'ready', progress = 100, size = $1, sha256 = $2 where id = $3",
    [progress.size, sha256, render.id],
  );
  await addEvent(
    render.job_id,
    'Clapstick',
    'filmReady',
    say.filmReady(render.cut_number),
  );
}
