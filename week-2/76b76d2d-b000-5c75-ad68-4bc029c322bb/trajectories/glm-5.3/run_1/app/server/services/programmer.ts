import { DateTime } from 'luxon';
import { query, withTransaction } from './database';
import type { PoolClient } from 'pg';
import type { KillBillClient } from './killbill';
import type { OutboxService } from './outbox';
import type { Config } from '../config';
import { ApiError } from '../http/errors';
import {
  seasonTimeDerived, weeklyInstants, type SeasonState,
} from '../domain/model';
import { iso, dateOnly, torontoTz } from '../time';

export interface SeasonView {
  slug: string;
  title: string;
  title_en: string;
  title_fr: string;
  state: SeasonState;
  public_sale_date: string;
  priority_opens_at: string;
  public_opens_at: string;
  first_date: string | null;
  last_date: string | null;
  screening_count: number;
}

export interface ScreeningView {
  id: string;
  film_title: string;
  format: string;
  auditorium: string;
  starts_at: string;
  starts_local: string;
}

interface SeasonRow {
  slug: string;
  title_en: string;
  title_fr: string;
  public_sale_date: string;
  state: string;
}

function priorityOpensAt(publicSaleDate: string): DateTime {
  return DateTime.fromISO(`${publicSaleDate}T10:00:00`, { zone: torontoTz }).minus({ days: 3 });
}

function publicOpensAt(publicSaleDate: string): DateTime {
  return DateTime.fromISO(`${publicSaleDate}T10:00:00`, { zone: torontoTz });
}

/** The one season-state derivation: stored states plus the time-derived three. */
export function liveSeasonState(row: SeasonRow): SeasonState {
  if (row.state === 'scheduled') {
    return seasonTimeDerived(row.public_sale_date, DateTime.now());
  }
  return row.state as SeasonState;
}

export async function seasonViews(includeDraft: boolean): Promise<SeasonView[]> {
  const seasons = await query<SeasonRow>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons',
  );
  const out: SeasonView[] = [];
  for (const row of seasons.rows) {
    const live = liveSeasonState(row);
    if (!includeDraft && (live === 'draft' || live === 'archived' || live === 'withdrawn')) continue;
    const screenings = await query<{ starts_at: Date }>(
      'SELECT starts_at FROM screenings WHERE season_slug = $1 ORDER BY starts_at',
      [row.slug],
    );
    const dates = screenings.rows.map(s => DateTime.fromJSDate(s.starts_at).setZone(torontoTz));
    out.push({
      slug: row.slug,
      title: '',
      title_en: row.title_en,
      title_fr: row.title_fr,
      state: live,
      public_sale_date: row.public_sale_date,
      priority_opens_at: iso(priorityOpensAt(row.public_sale_date)),
      public_opens_at: iso(publicOpensAt(row.public_sale_date)),
      first_date: dates.length > 0 ? dateOnly(dates[0]) : null,
      last_date: dates.length > 0 ? dateOnly(dates[dates.length - 1]) : null,
      screening_count: dates.length,
    });
  }
  out.sort((a, b) => {
    const aFirst = a.first_date ?? '9999-12-31';
    const bFirst = b.first_date ?? '9999-12-31';
    if (aFirst !== bFirst) return aFirst < bFirst ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });
  return out;
}

export async function createSeason(input: {
  slug: string;
  titleEn: string;
  titleFr: string;
  publicSaleDate: string;
}): Promise<SeasonView> {
  const existing = await query('SELECT slug FROM seasons WHERE slug = $1', [input.slug]);
  if (existing.rows.length > 0) throw new ApiError('slug_taken');
  await query(
    `INSERT INTO seasons (slug, title_en, title_fr, public_sale_date, state) VALUES ($1,$2,$3,$4,'draft')`,
    [input.slug, input.titleEn, input.titleFr, input.publicSaleDate],
  );
  const seasons = await seasonViews(true);
  return seasons.find(s => s.slug === input.slug) as SeasonView;
}

export async function addScreenings(input: {
  slug: string;
  filmTitle: string;
  format: string;
  auditorium: string;
  firstLocal: string;
  weeks: number;
}): Promise<{ screenings: ScreeningView[] }> {
  const season = await query<SeasonRow>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons WHERE slug = $1',
    [input.slug],
  );
  const row = season.rows[0];
  if (!row) throw new ApiError('not_found');
  if (row.state === 'archived' || row.state === 'withdrawn') throw new ApiError('season_closed');

  const count = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM screenings WHERE season_slug = $1',
    [input.slug],
  );
  const startOrdinal = Number(count.rows[0].count);

  const instants = weeklyInstants(input.firstLocal, input.weeks);
  const created: ScreeningView[] = [];
  for (let i = 0; i < instants.length; i++) {
    const id = `${input.slug}-${startOrdinal + i + 1}`;
    const startsLocal = `${instants[i].toFormat('yyyy-MM-dd')}T${instants[i].toFormat('HH:mm')}`;
    await query(
      `INSERT INTO screenings (id, season_slug, film_title, format, auditorium, starts_at, starts_local, ordinal, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'')`,
      [id, input.slug, input.filmTitle, input.format, input.auditorium,
        instants[i].toUTC().toJSDate(), startsLocal, startOrdinal + i + 1],
    );
    created.push({
      id,
      film_title: input.filmTitle,
      format: input.format,
      auditorium: input.auditorium,
      starts_at: iso(instants[i]),
      starts_local: startsLocal,
    });
  }
  return { screenings: created };
}

export interface TransitionDeps {
  cfg: Config;
  kb: KillBillClient;
  outbox: OutboxService;
}

/**
 * The one season state machine: draft → scheduled, on-sale → archived,
 * scheduled or on-sale → withdrawn; every other move is refused.
 */
export async function transitionSeason(
  deps: TransitionDeps,
  slug: string,
  to: 'scheduled' | 'archived' | 'withdrawn',
  reason: string,
  actorEmail: string,
): Promise<{ season: SeasonView; refunded_bookings: number }> {
  const season = await query<SeasonRow>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons WHERE slug = $1',
    [slug],
  );
  const row = season.rows[0];
  if (!row) throw new ApiError('not_found');
  const live = liveSeasonState(row);

  let refunded = 0;

  if (to === 'scheduled') {
    if (live !== 'draft') throw new ApiError('illegal_transition', { params: { from: live, to } });
    const count = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM screenings WHERE season_slug = $1',
      [slug],
    );
    if (Number(count.rows[0].count) === 0) throw new ApiError('season_empty');
    await query(`UPDATE seasons SET state='scheduled' WHERE slug=$1`, [slug]);
  } else if (to === 'archived') {
    if (live !== 'on-sale') throw new ApiError('illegal_transition', { params: { from: live, to } });
    const future = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM screenings WHERE season_slug = $1 AND starts_at > now()`,
      [slug],
    );
    if (Number(future.rows[0].count) > 0) throw new ApiError('season_has_future_screenings');
    await query(`UPDATE seasons SET state='archived' WHERE slug=$1`, [slug]);
  } else {
    if (live !== 'scheduled' && live !== 'on-sale') {
      throw new ApiError('illegal_transition', { params: { from: live, to } });
    }
    // Withdrawal: end live holds, refund each paid booking, then archive.
    const { refundBooking } = await import('./refund');
    const titleEn = row.title_en;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE holds SET state='expired', ended_by='season'
         WHERE state='held' AND screening_id IN (SELECT id FROM screenings WHERE season_slug=$1)`,
        [slug],
      );
      await client.query(
        `DELETE FROM seat_claims WHERE hold_id IN (
           SELECT id FROM holds WHERE screening_id IN (SELECT id FROM screenings WHERE season_slug=$1)
         )`,
        [slug],
      );
    });
    const paidBookings = await query<{ ref: string; starts_at: Date }>(
      `SELECT b.ref, s.starts_at FROM bookings b
       JOIN screenings s ON s.id = b.screening_id
       WHERE s.season_slug = $1 AND b.state = 'paid'
       ORDER BY b.ref`,
      [slug],
    );
    for (const booking of paidBookings.rows) {
      await refundBooking(deps, {
        ref: booking.ref,
        reason: { seasonTitle: titleEn },
        actor: actorEmail,
        startsAt: DateTime.fromJSDate(booking.starts_at),
      }).catch((err) => {
        if (err instanceof ApiError && err.code === 'refund_window_closed') {
          // A booking too close to showtime cannot be refunded; it is left alone.
          return;
        }
        throw err;
      });
      refunded += 1;
    }
    await withTransaction(async (client) => {
      await client.query(`UPDATE seasons SET state='withdrawn' WHERE slug=$1`, [slug]);
      const total = await client.query<{ total: string | null }>(
        `SELECT sum(amount_cents)::text AS total FROM audit_log
         WHERE action='refund' AND target IN (
           SELECT b.ref FROM bookings b JOIN screenings s ON s.id=b.screening_id WHERE s.season_slug=$1
         )`,
        [slug],
      );
      await client.query(
        `INSERT INTO audit_log (actor, action, target, amount_cents, reason)
         VALUES ($1,'season-withdraw',$2,$3,$4)`,
        [actorEmail, slug, total.rows[0].total ? Number(total.rows[0].total) : 0, reason],
      );
    });
  }

  const seasons = await seasonViews(true);
  const seasonOut = seasons.find(s => s.slug === slug) as SeasonView;
  return { season: seasonOut, refunded_bookings: refunded };
}

export async function seasonScreeningsForConsole(slug: string): Promise<ScreeningView[]> {
  const res = await query<{ id: string; film_title: string; format: string; auditorium: string; starts_at: Date; starts_local: string }>(
    `SELECT id, film_title, format, auditorium, starts_at, starts_local
     FROM screenings WHERE season_slug = $1 ORDER BY starts_at, ordinal`,
    [slug],
  );
  return res.rows.map(s => ({
    id: s.id,
    film_title: s.film_title,
    format: s.format,
    auditorium: s.auditorium,
    starts_at: iso(DateTime.fromJSDate(s.starts_at)),
    starts_local: s.starts_local,
  }));
}

export { seasonTimeDerived };
export type { PoolClient };
