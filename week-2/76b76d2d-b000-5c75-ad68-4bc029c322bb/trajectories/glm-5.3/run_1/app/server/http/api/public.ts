import { DateTime } from 'luxon';
import { Router } from 'express';
import { query } from '../../services/database';
import type { AppServices } from './handlers';
import { handler, json, param, bodyOf } from './handlers';
import { ApiError } from '../errors';
import { notFoundError } from '../errors';
import type { CookiedRequest } from '../scope';
import { ensureHoldSession } from '../scope';
import {
  isFare, type Fare, type Tier, type Cadence, type Locale,
  upliftPresets, individualHoldMin, individualHoldMax, groupHoldMin, groupHoldMax,
  fareOrder, type StepupPurpose,
} from '../../domain/model';
import { seatSort } from '../../domain/seats';
import { iso, dateOnly, timeOnly, torontoTz } from '../../time';
import { createSession } from '../../services/store';
import { maskedEmail, seatsLeft } from '../../domain/i18n';
import {
  seasonViews, seasonScreeningsForConsole, liveSeasonState,
} from '../../services/programmer';
import { createHold, holdView, releaseHold, getHoldRaw, assertHoldOwnership, expireHoldIfNeeded } from '../../services/booking';
import { quoteHold, defaultFares, computeQuote, fareRuleErrors, upliftError, holdForOwner } from '../../services/checkout-core';
import {
  checkoutBooking, idempotencyReplay, storeIdempotent, bookingView, bookingViewFromRows,
} from '../../services/checkout';
import { refundBooking, bookingByRef } from '../../services/refund';

import { membershipRow, membershipView, joinMembership, changeMembership, type PatronAccount } from '../../services/membership';
import { purchaseGift, giftByToken, redeemGift, giftTokenView } from '../../services/gifts';
import {
  startStepup, resendStepup, verifyStepup, stepupVerified, stepupNeeded,
} from '../../services/stepup';
import { creditBalance, issueGoodwillCredit, createEnquiry, replyEnquiry } from '../../services/finance';
import { bookingConfirmationEmail, emailText, emailHtml, bookingLinkEmail } from '../../mail/templates';
import { isSafePath } from '../../domain/safepath';

interface ScreeningFull {
  id: string;
  season_slug: string;
  film_title: string;
  format: string;
  auditorium: string;
  starts_at: Date;
  starts_local: string;
  notes: string;
}

async function screeningById(id: string): Promise<ScreeningFull | null> {
  const res = await query<ScreeningFull>(
    `SELECT id, season_slug, film_title, format, auditorium, starts_at, starts_local, notes
     FROM screenings WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

async function seasonRow(slug: string): Promise<{
  slug: string; title_en: string; title_fr: string; public_sale_date: string; state: string;
} | null> {
  const res = await query<{
    slug: string; title_en: string; title_fr: string; public_sale_date: string; state: string;
  }>(
    'SELECT slug, title_en, title_fr, public_sale_date::text AS public_sale_date, state FROM seasons WHERE slug = $1',
    [slug],
  );
  return res.rows[0] ?? null;
}

/** All seats of an auditorium, in seat order. */
async function auditoriumSeats(code: string): Promise<string[]> {
  const res = await query<{ rows: string; seats_per_row: number }>(
    'SELECT rows, seats_per_row FROM auditoriums WHERE code = $1',
    [code],
  );
  const aud = res.rows[0];
  if (!aud) return [];
  const seats: string[] = [];
  for (const row of aud.rows) {
    for (let n = 1; n <= aud.seats_per_row; n++) {
      seats.push(`${row}${n}`);
    }
  }
  return seats;
}

interface SeatStateRow { seat: string; hold_state: string | null; expires_at: Date | null; booking_ref: string | null; hold_session: string | null }

async function screeningSeatView(screeningId: string, sessionToken: string | null): Promise<{
  capacity: number; sold: number; held: number; seats_remaining: number;
  seats: { code: string; state: 'available' | 'held' | 'sold' | 'mine' }[];
}> {
  const screening = await screeningById(screeningId);
  if (!screening) throw notFoundError();
  const allSeats = await auditoriumSeats(screening.auditorium);
  const claims = await query<SeatStateRow>(
    `SELECT sc.seat, h.state AS hold_state, h.expires_at, sc.booking_ref, h.session_token AS hold_session
     FROM seat_claims sc
     LEFT JOIN holds h ON h.id = sc.hold_id
     WHERE sc.screening_id = $1`,
    [screeningId],
  );
  const stateBySeat = new Map<string, { code: string; state: 'available' | 'held' | 'sold' | 'mine' }>();
  for (const seat of allSeats) {
    stateBySeat.set(seat, { code: seat, state: 'available' });
  }
  let sold = 0;
  let held = 0;
  const now = DateTime.now();
  for (const claim of claims.rows) {
    const entry = stateBySeat.get(claim.seat);
    if (!entry) continue;
    if (claim.booking_ref) {
      entry.state = 'sold';
      sold += 1;
      continue;
    }
    if (claim.hold_state === 'held' && claim.expires_at && DateTime.fromJSDate(claim.expires_at) > now) {
      held += 1;
      entry.state = claim.hold_session === sessionToken ? 'mine' : 'held';
    }
  }
  return {
    capacity: allSeats.length,
    sold,
    held,
    seats_remaining: Math.max(0, allSeats.length - sold - held),
    seats: seatSort(allSeats).map(seat => stateBySeat.get(seat) as { code: string; state: 'available' | 'held' | 'sold' | 'mine' }),
  };
}

async function patronFromScope(req: CookiedRequest): Promise<PatronAccount | null> {
  const account = req.scope?.account ?? null;
  if (!account || account.role !== 'patron') return null;
  return {
    id: account.id,
    number: account.number as string,
    name: account.name,
    email: account.email,
    locale: (account.locale === 'fr' ? 'fr' : 'en') as Locale,
  };
}

async function memberContext(req: CookiedRequest): Promise<{
  isMember: boolean;
  memberTier: Tier | null;
  creditBalance: number;
  verified: boolean;
}> {
  const patron = await patronFromScope(req);
  if (!patron) {
    return { isMember: false, memberTier: null, creditBalance: 0, verified: false };
  }
  const membership = await membershipRow(patron.id);
  const credit = await creditBalance(patron.number);
  const verified = await stepupVerified(patron.id);
  return {
    isMember: membership !== null,
    memberTier: membership?.tier ?? null,
    creditBalance: credit.balance_cents,
    verified,
  };
}

export function publicApi(services: AppServices): Router {
  const router = Router();

  // Status; health is answered directly by the app, before any dependency.
  router.get('/api/status', handler(async (req, res) => {
    void req;
    json(res, 200, services.status.status());
  }));

  // Locale.
  router.post('/api/locale', handler(async (req, res) => {
    const body = bodyOf<{ locale?: unknown }>(req);
    const locale = body.locale;
    if (locale !== 'en' && locale !== 'fr') {
      const fields: Record<string, string> = {
        locale: req.scope?.locale === 'en' ? 'Choose one of the listed options.' : "Choisissez l'une des options proposées.",
      };
      throw new ApiError('validation', { fields });
    }
    res.setHeader('Set-Cookie', `halide_locale=${locale}; Path=/; HttpOnly; SameSite=Lax`);
    if (req.scope?.account) {
      await query('UPDATE accounts SET locale=$2 WHERE id=$1', [req.scope.account.id, locale]);
    }
    res.status(204).end();
  }));

  // Seasons.
  router.get('/api/seasons', handler(async (req, res) => {
    void req;
    const seasons = await seasonViews(false);
    json(res, 200, { seasons: seasons.map(s => ({ ...s, title: req.scope?.locale === 'fr' ? s.title_fr : s.title_en })) });
  }));
  router.get('/api/seasons/:slug', handler(async (req, res) => {
    const row = await seasonRow(param(req, 'slug'));
    if (!row) throw notFoundError();
    const live = liveSeasonState(row);
    if (live === 'draft' || live === 'archived' || live === 'withdrawn') throw notFoundError();
    const seasons = await seasonViews(false);
    const season = seasons.find(s => s.slug === row.slug) as unknown as Record<string, unknown>;
    const screenings = await query<{ id: string; film_title: string; format: string; auditorium: string; starts_at: Date; capacity: number }>(
      `SELECT s.id, s.film_title, s.format, s.auditorium, s.starts_at, a.capacity
       FROM screenings s JOIN auditoriums a ON a.code = s.auditorium
       WHERE s.season_slug = $1 AND s.starts_at > now()
       ORDER BY s.starts_at, s.ordinal`,
      [row.slug],
    );
    const out = [];
    for (const s of screenings.rows) {
      const seats = await screeningSeatView(s.id, req.scope?.sessionId ?? null);
      out.push({
        id: s.id,
        film_title: s.film_title,
        format: s.format,
        auditorium: s.auditorium,
        starts_at: iso(DateTime.fromJSDate(s.starts_at)),
        starts_local: DateTime.fromJSDate(s.starts_at).setZone(torontoTz).toFormat('yyyy-MM-dd') + 'T' + DateTime.fromJSDate(s.starts_at).setZone(torontoTz).toFormat('HH:mm'),
        capacity: s.capacity,
        seats_remaining: seats.seats_remaining,
      });
    }
    season.screenings = out;
    json(res, 200, { season: { ...season, title: req.scope?.locale === 'fr' ? (season.title_fr as string) : (season.title_en as string) } });
  }));

  // Screenings.
  router.get('/api/screenings/:id', handler(async (req, res) => {
    const screening = await screeningById(param(req, 'id'));
    if (!screening) throw notFoundError();
    const season = await seasonRow(screening.season_slug);
    if (!season) throw notFoundError();
    const aud = await query<{ code: string; name: string; venue: string }>(
      `SELECT a.code, a.name, v.name AS venue FROM auditoriums a JOIN venues v ON v.code = a.venue_code WHERE a.code = $1`,
      [screening.auditorium],
    );
    const seatView = await screeningSeatView(screening.id, req.scope?.sessionId ?? null);
    json(res, 200, {
      screening: {
        id: screening.id,
        season_slug: screening.season_slug,
        film_title: screening.film_title,
        format: screening.format,
        auditorium: {
          code: aud.rows[0].code,
          name: aud.rows[0].name,
          venue: aud.rows[0].venue,
        },
        starts_at: iso(DateTime.fromJSDate(screening.starts_at)),
        starts_local: screening.starts_local,
        capacity: seatView.capacity,
        sold: seatView.sold,
        held: seatView.held,
        seats_remaining: seatView.seats_remaining,
        seats: seatView.seats,
        notes: screening.notes,
      },
    });
  }));

  // Holds.
  router.post('/api/holds', handler(async (req, res) => {
    const body = bodyOf<{ screening_id?: unknown; seats?: unknown; group?: unknown }>(req);
    const screeningId = typeof body.screening_id === 'string' ? body.screening_id : '';
    const seats = Array.isArray(body.seats)
      ? body.seats.filter((s: unknown): s is string => typeof s === 'string')
      : [];
    const group = body.group === true;
    if (!screeningId || seats.length === 0) {
      throw new ApiError('validation', {
        fields: { seats: group ? 'Choose 10 to 40 seats for a group.' : 'Choose 1 to 10 seats.' },
      });
    }
    const screening = await screeningById(screeningId);
    if (!screening) throw notFoundError();
    const season = await seasonRow(screening.season_slug);
    if (!season) throw notFoundError();
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');

    const member = await memberContext(req);
    const auditorium = await auditoriumSeats(screening.auditorium);
    const sessionToken = await ensureHoldSession(req, res, createSession);
    const hold = await createHold({
      screeningId,
      seats,
      group,
      sessionToken,
      accountId: req.scope?.account?.id ?? null,
      isMember: member.isMember,
      holdTtlSeconds: services.cfg.holdTtlSeconds,
      seasonState: liveSeasonState(season),
      seasonPublicSaleDate: season.public_sale_date,
      screeningStartsAt: DateTime.fromJSDate(screening.starts_at),
      auditoriumSeats: auditorium,
    });
    json(res, 201, { hold });
  }));

  router.get('/api/holds/:id', handler(async (req, res) => {
    const found = await getHoldRaw(param(req, 'id'));
    const owned = assertHoldOwnership(found, req.scope?.sessionId ?? '', req.scope?.account?.id ?? null);
    const row = await expireHoldIfNeeded(owned.row);
    json(res, 200, { hold: holdView(row, owned.seats) });
  }));

  router.post('/api/holds/:id/quote', handler(async (req, res) => {
    const body = bodyOf<{ fares?: unknown; uplift_cents?: unknown }>(req);
    const fares = (typeof body.fares === 'object' && body.fares !== null
      ? body.fares as Record<string, string>
      : null);
    const uplift = typeof body.uplift_cents === 'number' && Number.isInteger(body.uplift_cents) ? body.uplift_cents : 0;
    const member = await memberContext(req);
    const result = await quoteHold(
      param(req, 'id'),
      req.scope?.sessionId ?? '',
      {
        isMember: member.isMember,
        memberTier: member.memberTier,
        creditBalanceCents: member.creditBalance,
        stepupVerified: member.verified,
      },
      fares,
      uplift,
      req.scope?.locale ?? 'fr',
    );
    json(res, 200, { quote: result.view });
  }));

  router.delete('/api/holds/:id', handler(async (req, res) => {
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    const found = await getHoldRaw(param(req, 'id'));
    const owned = assertHoldOwnership(found, req.scope?.sessionId ?? '', req.scope?.account?.id ?? null);
    const released = await releaseHold(owned.row.id);
    json(res, 200, {
      hold: released,
      released_amount: { cents: 0, currency: 'CAD' },
    });
  }));

  return router;
}
