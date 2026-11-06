import { randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { licenceText } from '../../domain/rules.js';
import { isoDateIn, LICENCE_MARKETS, marketTown } from '../../domain/time.js';
import type { LicenceMarket } from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { ProviderBusy, ProviderDown, readPrices, searchTracks, takeLicence } from '../infra/providers.js';
import type { TrackPage } from '../infra/providers.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { addEvent, isoDateText, requireJob, requireWritableJob } from './support.js';

type CueRow = {
  id: string;
  job_id: string;
  track_id: string;
  title: string;
  composer: string;
  seconds: number;
  market: LicenceMarket;
  from_date: Date;
  until_date: Date;
  fee: string;
  licence_id: string;
};

export function cueJson(cue: CueRow): Record<string, unknown> {
  const until = isoDateText(cue.until_date);
  return {
    id: cue.id,
    trackId: cue.track_id,
    title: cue.title,
    composer: cue.composer,
    seconds: cue.seconds,
    market: cue.market,
    from: isoDateText(cue.from_date),
    until,
    fee: cue.fee,
    licenceId: cue.licence_id,
    licenceText: licenceText(until, isoDateIn(new Date(), marketTown(cue.market))),
  };
}

export async function readCues(jobId: string): Promise<CueRow[]> {
  return query<CueRow>('select * from cues where job_id = $1 order by created_at asc, id asc', [
    jobId,
  ]);
}

/** The same search text and cursor never call the library twice within the cache window. */
async function cachedSearch(text: string, cursor: string | null): Promise<TrackPage> {
  const key = `tracks:${cursor ?? ''}:${text}`;
  const kept = await one<{ body: TrackPage; fetched_at: Date }>(
    'select body, fetched_at from cue_cache where cache_key = $1',
    [key],
  );
  if (
    kept &&
    kept.fetched_at.getTime() + config.timers.cueCacheSeconds * 1000 > Date.now()
  ) {
    return kept.body;
  }
  const page = await searchTracks(text, cursor);
  await query(
    `insert into cue_cache (cache_key, body, fetched_at) values ($1,$2,now())
      on conflict (cache_key) do update set body = $2, fetched_at = now()`,
    [key, JSON.stringify(page)],
  );
  return page;
}

function unavailable(error: unknown): never {
  if (error instanceof ProviderDown || error instanceof ProviderBusy) {
    throw refuse.unavailable(COPY.musicUnavailable);
  }
  throw error;
}

export const cueRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/cues/search',
    handler: async (context) => {
      requireIdentity(context);
      const text = context.query.get('q') ?? '';
      if (text === '') return { status: 200, body: { tracks: [], nextCursor: null } };
      try {
        const page = await cachedSearch(text, context.query.get('cursor'));
        return { status: 200, body: page };
      } catch (error) {
        return unavailable(error);
      }
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/cues',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      return { status: 200, body: { cues: (await readCues(job.id)).map(cueJson) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/cues',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const trackId = fields.text(body, 'trackId', 'Pick a track.');
      const title = fields.text(body, 'title', 'Pick a track.');
      const composer = fields.optionalText(body, 'composer');
      const seconds = fields.wholeNumber(body, 'seconds', 1, 36_000);
      const market = fields.choice(body, 'market', LICENCE_MARKETS);
      const from = fields.isoDate(body, 'from');
      const until = fields.isoDate(body, 'until');
      fields.done();
      requireWritableJob(job);
      if (until < from) throw refuse.value(COPY.licenceBackwards);

      const today = isoDateIn(new Date(), 'amsterdam');
      let licenceId: string;
      let fee: string;
      try {
        const rows = await readPrices();
        const inEffect = rows
          .filter((row) => row.validFrom <= today)
          .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
          .at(-1);
        if (!inEffect) throw new ProviderDown('no price row in effect');
        fee = inEffect.perMarket;
        licenceId = await takeLicence({ trackId, market, from, until, fee });
      } catch (error) {
        return unavailable(error);
      }

      const id = randomUUID();
      await query(
        `insert into cues (id, job_id, track_id, title, composer, seconds, market,
                           from_date, until_date, fee, licence_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
        [id, job.id, trackId, title, composer, seconds, market, from, until, fee, licenceId],
      );
      await addEvent(job.id, desk.name, 'cueAdded', say.cueAdded(title));
      const made = await one<CueRow>('select * from cues where id = $1', [id]);
      return { status: 201, body: cueJson(made as CueRow) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/jobs/:id/cues/:cueId',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const cue = await one<CueRow>('select * from cues where id = $1 and job_id = $2', [
        requireUuidParam(context.params['cueId'] ?? ''),
        job.id,
      ]);
      if (!cue) throw refuse.notFound();
      requireWritableJob(job);
      await query('delete from cues where id = $1', [cue.id]);
      await addEvent(job.id, desk.name, 'cueRemoved', say.cueRemoved(cue.title));
      return { status: 204 };
    },
  },
];
