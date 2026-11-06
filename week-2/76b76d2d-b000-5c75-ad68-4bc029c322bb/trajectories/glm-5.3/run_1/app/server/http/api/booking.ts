import { DateTime } from 'luxon';
import { Router } from 'express';
import { query, withTransaction } from '../../services/database';
import type { AppServices } from './handlers';
import { handler, json, param, bodyOf } from './handlers';
import { ApiError, notFoundError, validationError } from '../errors';
import type { CookiedRequest } from '../scope';
import type { Fare, Locale, Tier, Cadence } from '../../domain/model';
import { refundDeadline } from '../../domain/model';
import { iso, torontoTz } from '../../time';
import { capabilityToken } from '../../domain/ids';
import { bookingLinkEmail, emailText, emailHtml } from '../../mail/templates';
import { isSafePath } from '../../domain/safepath';
import {
  getHoldRaw, assertHoldOwnership, expireHoldIfNeeded,
} from '../../services/booking';
import { quoteHold, type QuoteResult } from '../../services/checkout-core';
import {
  checkoutBooking, idempotencyReplay, storeIdempotent, bookingView,
} from '../../services/checkout';
import { refundBooking, bookingByRef, accountNumberForBooking } from '../../services/refund';
import { creditBalance, issueGoodwillCredit } from '../../services/finance';
import { membershipRow, membershipView, joinMembership, changeMembership, type PatronAccount } from '../../services/membership';
import { purchaseGift, giftByToken, redeemGift, giftTokenView } from '../../services/gifts';
import { stepupVerified, startStepup, resendStepup, verifyStepup, stepupNeeded } from '../../services/stepup';
import { nextSequence } from '../../services/membership';

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

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CheckoutBody {
  hold_id?: unknown;
  fares?: unknown;
  uplift_cents?: unknown;
  cardholder_name?: unknown;
  note?: unknown;
  guest?: unknown;
  split?: unknown;
}

export function bookingApi(services: AppServices): Router {
  const router = Router();

  router.post('/api/checkout', handler(async (req, res) => {
    const locale = req.scope?.locale ?? 'fr';
    const raw = (req as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    const body = bodyOf<CheckoutBody>(req);
    const holdId = typeof body.hold_id === 'string' ? body.hold_id : '';
    if (!holdId) {
      throw validationError({ hold_id: locale === 'en' ? 'Required.' : 'Obligatoire.' });
    }
    const patron = await patronFromScope(req);

    // Ownership: a hold that is not the caller's answers exactly like a missing one.
    const found = await getHoldRaw(holdId);
    const owned = assertHoldOwnership(found, req.scope?.sessionId ?? '', req.scope?.account?.id ?? null);

    // Idempotency: a replay answers its stored response before any later check.
    const idemKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : null;
    const replay = await idempotencyReplay({
      sessionToken: req.scope?.sessionId ?? '',
      accountId: patron?.id ?? null,
      accountNumber: patron?.number ?? null,
      accountName: patron?.name ?? null,
      accountEmail: patron?.email ?? null,
      idempotencyKey: idemKey,
      cardholderName: '',
      note: '',
      guest: null,
      split: null,
      locale,
    }, raw);
    if (replay) {
      res.setHeader('Idempotent-Replayed', 'true');
      const status = (replay.status as number) ?? 201;
      json(res, status, replay.body ?? replay);
      return;
    }

    const row = await expireHoldIfNeeded(owned.row);
    if (row.state === 'expired') throw new ApiError('hold_expired');
    if (row.state === 'paid') throw new ApiError('hold_already_paid');

    // A failure clears the in-progress record so the key can be retried.
    const fail = async (err: unknown): Promise<never> => {
      await query(`DELETE FROM idempotency WHERE key = $1 AND state = 'in_progress'`, [idemKey]);
      throw err;
    };

    // The quote: fares, uplift and credit decide step-up.
    const fares = (typeof body.fares === 'object' && body.fares !== null ? body.fares as Record<string, string> : null);
    const uplift = typeof body.uplift_cents === 'number' && Number.isInteger(body.uplift_cents) ? body.uplift_cents : 0;
    const membership = patron ? await membershipRow(patron.id) : null;
    const credit = patron ? await creditBalance(patron.number) : { balance_cents: 0, movements: [] };
    const verified = patron ? await stepupVerified(patron.id) : false;
    const quote = await quoteHold(holdId, req.scope?.sessionId ?? '', {
      isMember: membership !== null,
      memberTier: membership?.tier ?? null,
      creditBalanceCents: credit.balance_cents,
      stepupVerified: verified,
    }, fares, uplift, locale);

    // Step-up is required exactly when the quote applies credit without a live verification.
    if (quote.view.stepup_required) await fail(new ApiError('stepup_required'));

    // Billing availability, before anything can change.
    if (services.status.billingUp !== true) await fail(new ApiError('billing_unavailable'));

    // Field validation after state checks.
    const fields: Record<string, string> = {};
    const cardholder = typeof body.cardholder_name === 'string' ? body.cardholder_name.trim() : '';
    if (cardholder.length < 1 || cardholder.length > 80) {
      fields.cardholder_name = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    }
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : '';
    let guest: { name: string; email: string; phone: string } | null = null;
    if (!patron) {
      const g = (typeof body.guest === 'object' && body.guest !== null ? body.guest as Record<string, unknown> : {});
      const name = typeof g.name === 'string' ? g.name.trim() : '';
      const email = typeof g.email === 'string' ? g.email.trim() : '';
      const phone = typeof g.phone === 'string' ? g.phone.trim() : '';
      if (name.length < 1 || name.length > 80) fields['guest.name'] = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
      if (!emailRe.test(email) || email.length > 254) fields['guest.email'] = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
      if (phone.length > 0 && !/^[0-9 +\-()]{7,20}$/.test(phone)) fields['guest.phone'] = locale === 'en' ? 'Use 7 to 20 characters.' : 'Utilisez de 7 à 20 caractères.';
      guest = { name, email, phone };
    }
    let split: { name: string; seats: number }[] | null = null;
    if (row.group_booking) {
      const raw = Array.isArray(body.split) ? body.split : [];
      split = [];
      for (const p of raw) {
        const po = (typeof p === 'object' && p !== null ? p as Record<string, unknown> : {});
        const name = typeof po.name === 'string' ? po.name.trim() : '';
        const seats = typeof po.seats === 'number' && Number.isInteger(po.seats) ? po.seats : 0;
        split.push({ name, seats });
      }
    }
    if (Object.keys(fields).length > 0) await fail(validationError(fields));

    const screeningRes = await query<{
      id: string; film_title: string; starts_at: Date; auditorium: string;
    }>(
      `SELECT s.id, s.film_title, s.starts_at, s.auditorium FROM screenings s WHERE s.id = $1`,
      [row.screening_id],
    );
    const scr = screeningRes.rows[0];
    const audRes = await query<{ code: string; name: string }>(
      'SELECT code, name FROM auditoriums WHERE code = $1',
      [scr.auditorium],
    );

    const result = await checkoutBooking(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      {
        sessionToken: req.scope?.sessionId ?? '',
        accountId: patron?.id ?? null,
        accountNumber: patron?.number ?? null,
        accountName: patron?.name ?? null,
        accountEmail: patron?.email ?? null,
        idempotencyKey: idemKey,
        cardholderName: cardholder,
        note,
        guest,
        split,
        locale,
      },
      quote,
      {
        id: scr.id,
        filmTitle: scr.film_title,
        startsAt: DateTime.fromJSDate(scr.starts_at),
        auditoriumName: audRes.rows[0].name,
        auditoriumCode: audRes.rows[0].code,
      },
    );
    await storeIdempotent(idemKey as string, result.status, result.body);
    json(res, result.status, result.body);
  }));

  router.get('/api/bookings', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const result = await query<{ ref: string }>(
      'SELECT ref FROM bookings WHERE account_id = $1 ORDER BY created_at DESC',
      [patron.id],
    );
    const bookings = [];
    for (const r of result.rows) {
      bookings.push(await bookingView(r.ref));
    }
    json(res, 200, { bookings });
  }));

  router.get('/api/bookings/:ref', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const booking = await bookingByRef(param(req, 'ref'));
    if (!booking || booking.account_id !== patron.id) throw notFoundError();
    json(res, 200, { booking: await bookingView(booking.ref) });
  }));

  async function doRefund(req: CookiedRequest, res: import('express').Response, opts: {
    booking: { ref: string; account_id: number | null };
    actor: string;
    reason: 'self' | 'box-office';
  }): Promise<void> {
    const screeningRes = await query<{ starts_at: Date }>(
      `SELECT s.starts_at FROM screenings s JOIN bookings b ON b.screening_id = s.id WHERE b.ref = $1`,
      [opts.booking.ref],
    );
    const outcome = await refundBooking(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      {
        ref: opts.booking.ref,
        reason: opts.reason,
        actor: opts.actor,
        startsAt: DateTime.fromJSDate(screeningRes.rows[0].starts_at),
      },
    );
    json(res, 200, { refund: outcome.refund });
  }

  router.post('/api/bookings/:ref/refund', handler(async (req, res) => {
    const patron = await patronFromScope(req);
    if (!patron) throw new ApiError('unauthenticated');
    const booking = await bookingByRef(param(req, 'ref'));
    if (!booking || booking.account_id !== patron.id) throw notFoundError();
    await doRefund(req, res, { booking, actor: patron.number, reason: 'self' });
  }));

  router.get('/api/guest/bookings/:token', handler(async (req, res) => {
    const token = param(req, 'token');
    const link = await query<{ booking_ref: string; active: boolean }>(
      'SELECT booking_ref, active FROM guest_links WHERE token = $1',
      [token],
    );
    const l = link.rows[0];
    if (!l || !l.active) throw notFoundError();
    const booking = await bookingByRef(l.booking_ref);
    if (!booking) throw notFoundError();
    json(res, 200, { booking: await bookingView(booking.ref) });
  }));

  router.post('/api/guest/bookings/:token/refund', handler(async (req, res) => {
    const token = param(req, 'token');
    const link = await query<{ booking_ref: string; active: boolean }>(
      'SELECT booking_ref, active FROM guest_links WHERE token = $1',
      [token],
    );
    const l = link.rows[0];
    if (!l || !l.active) throw notFoundError();
    const booking = await bookingByRef(l.booking_ref);
    if (!booking) throw notFoundError();
    await doRefund(req, res, { booking, actor: 'guest', reason: 'self' });
  }));

  router.post('/api/guest/booking-links', handler(async (req, res) => {
    const body = bodyOf<{ booking_ref?: unknown; email?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const ref = typeof body.booking_ref === 'string' ? body.booking_ref.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const fields: Record<string, string> = {};
    if (!/^HB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(ref)) {
      fields.booking_ref = locale === 'en' ? 'Required.' : 'Obligatoire.';
    }
    if (!emailRe.test(email)) {
      fields.email = locale === 'en' ? 'Enter a valid email address.' : 'Entrez une adresse courriel valide.';
    }
    if (Object.keys(fields).length > 0) throw validationError(fields);

    // Always 202: a match creates a new token and kills the old one.
    const booking = await bookingByRef(ref);
    if (booking && booking.guest_email && booking.guest_email.toLowerCase() === email.toLowerCase()
      && (booking.state === 'paid' || booking.state === 'checked-in')) {
      const newToken = capabilityToken();
      await withTransaction(async (client) => {
        await client.query(`UPDATE guest_links SET active=false WHERE booking_ref=$1`, [booking.ref]);
        await client.query(
          `INSERT INTO guest_links (token, booking_ref, active) VALUES ($1,$2,true)`,
          [newToken, booking.ref],
        );
        const emailContent = bookingLinkEmail(booking.locale === 'fr' ? 'fr' : 'en', booking.ref,
          `${services.cfg.publicUrl}/${booking.locale}/b/${newToken}`);
        const seq = await nextSequence(client, `booking-link:${booking.ref}`);
        services.outbox.enqueueInTx(client, {
          messageKey: `booking-link:${booking.ref}:${seq}`,
          kind: 'booking-link',
          to: email,
          subject: emailContent.subject,
          bodyText: emailText(emailContent.lines),
          html: emailHtml(emailContent.lines),
          locale: booking.locale === 'fr' ? 'fr' : 'en',
        });
      });
    }
    json(res, 202, { status: 'accepted' });
  }));

  return router;
}
