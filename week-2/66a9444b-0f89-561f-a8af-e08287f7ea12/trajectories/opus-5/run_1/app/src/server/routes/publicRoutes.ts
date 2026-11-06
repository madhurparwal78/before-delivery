import { Router } from 'express';
import { many, pool, postgresUp } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { ErrorBag } from '../http/validate.js';
import { readSignedToken } from '../http/signed.js';
import { getObject, storageUp } from '../services/storage.js';
import { health as killbillHealth } from '../services/killbill.js';
import { mailUp } from '../services/mail.js';
import { listEntries, loadEntryImage, serialiseEntry } from '../domain/entries.js';
import {
  festivalDays,
  listSessions,
  loadDisciplines,
  loadEdition,
  loadPricePolicy,
  loadSession,
  loadVenues,
  serialiseSession,
} from '../domain/programme.js';
import { PUBLIC_STATES } from '../domain/states.js';
import { TIME_ZONE } from '../lib/time.js';

export const publicRouter = Router();

interface HealthSnapshot {
  at: number;
  services: Record<string, 'up' | 'down'>;
}

let lastHealth: HealthSnapshot | null = null;
const HEALTH_CACHE_MS = 2000;

publicRouter.get('/health', async (_req, res) => {
  if (lastHealth !== null && Date.now() - lastHealth.at < HEALTH_CACHE_MS) {
    res.status(200).json({ status: 'ok', services: lastHealth.services });
    return;
  }
  const [postgres, killbill, mailpit, minio] = await Promise.all([
    postgresUp(),
    killbillHealth(),
    mailUp(),
    storageUp(),
  ]);
  const services = {
    postgres: postgres ? ('up' as const) : ('down' as const),
    killbill: killbill ? ('up' as const) : ('down' as const),
    mailpit: mailpit ? ('up' as const) : ('down' as const),
    minio: minio ? ('up' as const) : ('down' as const),
  };
  lastHealth = { at: Date.now(), services };
  res.status(200).json({ status: 'ok', services });
});

publicRouter.get('/programme', async (req, res) => {
  const edition = await loadEdition(pool);
  const venues = await loadVenues(pool);
  const disciplines = await loadDisciplines(pool);
  const days = festivalDays(edition);

  const bag = new ErrorBag();
  const day = typeof req.query['day'] === 'string' ? req.query['day'] : null;
  const venue = typeof req.query['venue'] === 'string' ? req.query['venue'] : null;
  const discipline =
    typeof req.query['discipline'] === 'string' ? req.query['discipline'] : null;
  if (day !== null && !days.some((candidate) => candidate.date === day)) bag.add('day', 'unknown');
  if (venue !== null && !venues.some((candidate) => candidate.id === venue)) {
    bag.add('venue', 'unknown');
  }
  if (discipline !== null && !disciplines.some((candidate) => candidate.id === discipline)) {
    bag.add('discipline', 'unknown');
  }
  bag.throwIfAny();

  const rows = await listSessions(pool, { statuses: PUBLIC_STATES });
  const sessions = rows
    .map((row) => serialiseSession(row, false))
    .filter((session) => day === null || session.festival_day === day)
    .filter((session) => venue === null || session.venue_id === venue)
    .filter((session) => discipline === null || session.discipline === discipline);

  const policy = await loadPricePolicy(pool);
  res.status(200).json({
    edition: {
      name: edition.name,
      first_day: edition.first_day,
      last_day: edition.last_day,
      time_zone: TIME_ZONE,
    },
    festival_days: days,
    venues,
    disciplines,
    sessions,
    // the pass prices the Tickets section and checkout quote
    price_policy: {
      full_festival_full_cents: policy.full_festival_full_cents,
      full_festival_reduced_cents: policy.full_festival_reduced_cents,
      day_full_cents: policy.day_full_cents,
      day_reduced_cents: policy.day_reduced_cents,
      group_discount_percent: policy.group_discount_percent,
    },
  });
});

publicRouter.get('/sessions/:id', async (req, res) => {
  const session = await loadSession(pool, req.params.id);
  if (session === null) throw notFound();
  const curator = req.caller?.role === 'curator';
  if (!curator && !PUBLIC_STATES.includes(session.effective_status)) throw notFound();
  res.status(200).json(serialiseSession(session, curator));
});

publicRouter.get('/gallery', async (_req, res) => {
  const rows = await listEntries(pool, { statuses: ['published'] });
  const entries = [];
  for (const row of rows) {
    entries.push(await serialiseEntry(pool, row));
  }
  res.status(200).json({ entries });
});

publicRouter.get('/media/artworks/:imageId', async (req, res) => {
  const image = await loadEntryImage(pool, req.params.imageId);
  if (image === null) throw notFound();
  const entries = await many<{ effective_status: string }>(
    pool,
    `SELECT CASE WHEN status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now()
                THEN 'published' ELSE status END AS effective_status
     FROM entries WHERE id = $1`,
    [image.entry_id],
  );
  if (entries[0]?.effective_status !== 'published') throw notFound();
  const stored = await getObject(image.display_key);
  if (stored === null) throw notFound();
  res.status(200).type('image/jpeg').send(stored.body);
});

publicRouter.get('/files/:token', async (req, res) => {
  const key = await readSignedToken(req.params.token);
  const stored = await getObject(key);
  if (stored === null) throw notFound();
  res.status(200);
  res.setHeader('Content-Type', stored.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(stored.body);
});
