import { randomUUID } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { addHistory, assertJobWritable, cueJson, loadJob } from '../records';
import { one, pool, rows, type Row } from '../db';
import { isUuid, noContent, notFound, ok, route } from '../http';
import { buyLicence, currentFee, searchTracks } from '../providers';
import { checkDate, checkOneOf, filled, throwIfAny, type Fields } from '../validate';

const MARKETS = ['NL', 'US', 'CA', 'AE'] as const;

route('GET', '/api/cues/search', {}, async ({ query, now }) => {
  const q = query.get('q') ?? '';
  if (!q) return ok({ tracks: [], nextCursor: null });
  return ok(await searchTracks(q, query.get('cursor'), now));
});

route('GET', '/api/jobs/:id/cues', { load: loadJob }, async ({ found, now }) => {
  const cues = await rows(pool, 'SELECT * FROM cues WHERE job_id = $1 ORDER BY seq', [found.id]);
  return ok({ cues: cues.map((cue) => cueJson(cue, now)) });
});

route('POST', '/api/jobs/:id/cues', { load: loadJob }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  if (!filled(body.trackId) || !filled(body.title)) fields.trackId = COPY.typeTitle;
  const market = checkOneOf(fields, 'market', body.market, MARKETS, 'Pick a market.');
  const from = checkDate(fields, 'from', body.from);
  const until = checkDate(fields, 'until', body.until);
  if (!fields.from && !fields.until && until < from) fields.until = COPY.licenceBackwards;
  throwIfAny(fields);
  assertJobWritable(found);
  const fee = await currentFee(now);
  const licenceId = await buyLicence({ trackId: body.trackId as string, market, from, until, fee });
  const cue = await one(
    pool,
    `INSERT INTO cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [randomUUID(), found.id, body.trackId, body.title, typeof body.composer === 'string' ? body.composer : '', Number.isInteger(body.seconds) ? body.seconds : 0, market, from, until, fee, licenceId],
  );
  await addHistory(pool, found.id, desk.name, 'cueAdded', fill(COPY.cueAdded, { title: body.title as string }), now);
  return ok(cueJson(cue as Row, now), 201);
});

route(
  'DELETE',
  '/api/jobs/:id/cues/:cue',
  {
    load: async (context) => {
      const job = await loadJob(context);
      if (!isUuid(context.params.cue)) throw notFound();
      const cue = await one(pool, 'SELECT * FROM cues WHERE id = $1 AND job_id = $2', [context.params.cue, job.id]);
      if (!cue) throw notFound();
      return { job, cue };
    },
  },
  async ({ found, desk, now }) => {
    assertJobWritable(found.job);
    await pool.query('DELETE FROM cues WHERE id = $1', [found.cue.id]);
    await addHistory(pool, found.job.id, desk.name, 'cueRemoved', fill(COPY.cueRemoved, { title: found.cue.title }), now);
    return noContent();
  },
);
