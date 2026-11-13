import { Router } from 'express';
import { pool } from '../db.js';
import { VENUES } from '../domain/seed.js';
import * as dates from '../domain/dates.js';
import type { Config } from '../config.js';

export function venuesRouter(cfg: Config): Router {
  const router = Router();

  router.get('/venues', (req, res) => {
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim().toLowerCase() : '';
    if (q === '') {
      res.json({ venues: [] });
      return;
    }
    const matches = VENUES.filter((v) => `${v.name} ${v.address} ${v.city}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((v) => ({ id: v.id, name: v.name, address: v.address, city: v.city, timeZone: v.timeZone, taxRateBp: v.taxRateBp }));
    res.json({ venues: matches });
  });

  router.get('/venues/:venueId/days', async (req, res, next) => {
    try {
      const from = req.query['from'];
      const to = req.query['to'];
      if (typeof from !== 'string' || typeof to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        res.status(422).json({ errors: { to: 'Ask for at most 62 days.' } });
        return;
      }
      const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
      if (spanDays > 62 || spanDays < 0) {
        res.status(422).json({ errors: { to: 'Ask for at most 62 days.' } });
        return;
      }
      const venue = VENUES.find((v) => v.id === (req.params as { venueId?: string })['venueId']);
      if (!venue) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      const tx = await pool.connect();
      try {
        const days: Array<{ date: string; status: string; startsAt: string; endsAt: string }> = [];
        let cursor = from;
        while (cursor <= to) {
          const booked = await tx.query(`SELECT 1 FROM install_days WHERE venue_id = $1 AND date = $2`, [venue.id, cursor]);
          let status = 'free';
          if (booked.rowCount && booked.rowCount > 0) {
            status = 'booked';
          } else {
            const held = await tx.query(`SELECT 1 FROM holds WHERE venue_id = $1 AND date = $2 AND state = 'held' AND expires_at > now()`, [venue.id, cursor]);
            if (held.rowCount && held.rowCount > 0) {
              status = 'held';
            } else {
              const today = dates.localDate(new Date(), venue.timeZone);
              const win = dates.bookableWindow(today);
              if (cursor < win.from || cursor > win.to) status = 'unavailable';
            }
          }
          const start = dates.startOfLocalDay(cursor, venue.timeZone);
          const end = dates.startOfLocalDay(dates.addDays(cursor, 1), venue.timeZone);
          days.push({
            date: cursor,
            status,
            startsAt: withOffset(start, venue.timeZone),
            endsAt: withOffset(end, venue.timeZone),
          });
          cursor = dates.addDays(cursor, 1);
        }
        res.json({ days });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/** Venue-related instants carry the venue's UTC offset. */
export function withOffset(at: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  const localMs = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')) % 24, Number(get('minute')), Number(get('second')));
  const offsetMs = localMs - (at.getTime() - (at.getTime() % 1000));
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs) / 60000;
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(Math.floor(abs % 60)).padStart(2, '0');
  const utc = at.toISOString().slice(0, 19);
  return `${utc}${sign}${hh}:${mm}`;
}
