import { Router } from 'express';
import type { Request, Response } from 'express';
import { query } from '../../services/database';
import type { AppServices } from './handlers';
import { handler, json, param, bodyOf } from './handlers';
import { ApiError, notFoundError, validationError, sendError, type ApiError as ApiErrorType } from '../errors';
import type { CookiedRequest } from '../scope';
import { doorScreenings, doorList, checkInTicket, checkInBooking } from '../../services/door';
import {
  createSeason, addScreenings, transitionSeason, seasonViews, seasonScreeningsForConsole,
} from '../../services/programmer';
import {
  auditList, issueGoodwillCredit, reconciliationFor, acceptReconciliation,
  reconciliationCsv, listEnquiries, replyEnquiry, creditBalance,
} from '../../services/finance';
import { refundBooking, bookingByRef } from '../../services/refund';
import { bookingView } from '../../services/checkout';
import { DateTime } from 'luxon';
import { torontoTz } from '../../time';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const slugRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function staffApi(services: AppServices): Router {
  const router = Router();

  // ===== Door =====
  router.get('/api/door/screenings', handler(async (req, res) => {
    req.scope?.requireRole('door');
    json(res, 200, await doorScreenings());
  }));

  router.get('/api/door/screenings/:id/list', handler(async (req, res) => {
    req.scope?.requireRole('door');
    json(res, 200, await doorList(param(req, 'id')));
  }));

  router.post('/api/door/tickets/:code/check-in', handler(async (req, res) => {
    req.scope?.requireRole('door');
    json(res, 200, await checkInTicket(param(req, 'code')));
  }));

  router.post('/api/door/bookings/:ref/check-in', handler(async (req, res) => {
    req.scope?.requireRole('door');
    json(res, 200, await checkInBooking(param(req, 'ref')));
  }));

  // ===== Programmer =====
  router.get('/api/programmer/seasons', handler(async (req, res) => {
    req.scope?.requireRole('programmer');
    const seasons = await seasonViews(true);
    const out = [];
    for (const season of seasons) {
      out.push({
        ...season,
        title: req.scope?.locale === 'fr' ? season.title_fr : season.title_en,
        screenings: await seasonScreeningsForConsole(season.slug),
      });
    }
    json(res, 200, { seasons: out });
  }));

  router.post('/api/programmer/seasons', handler(async (req, res) => {
    req.scope?.requireRole('programmer');
    const body = bodyOf<{ slug?: unknown; title_en?: unknown; title_fr?: unknown; public_sale_date?: unknown }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const titleEn = typeof body.title_en === 'string' ? body.title_en.trim() : '';
    const titleFr = typeof body.title_fr === 'string' ? body.title_fr.trim() : '';
    const saleDate = typeof body.public_sale_date === 'string' ? body.public_sale_date : '';
    if (!slugRe.test(slug) || slug.length < 3 || slug.length > 40) {
      fields.slug = locale === 'en' ? 'Use 3 to 40 characters.' : 'Utilisez de 3 à 40 caractères.';
    }
    if (titleEn.length < 1 || titleEn.length > 80) fields.title_en = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    if (titleFr.length < 1 || titleFr.length > 80) fields.title_fr = locale === 'en' ? 'Use 1 to 80 characters.' : 'Utilisez de 1 à 80 caractères.';
    if (!dateRe.test(saleDate)) fields.public_sale_date = locale === 'en' ? 'Enter a valid date.' : 'Entrez une date valide.';
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const season = await createSeason({ slug, titleEn, titleFr, publicSaleDate: saleDate });
    json(res, 201, {
      season: {
        ...season,
        title: locale === 'fr' ? season.title_fr : season.title_en,
        screenings: [],
      },
    });
  }));

  router.post('/api/programmer/seasons/:slug/screenings', handler(async (req, res) => {
    req.scope?.requireRole('programmer');
    const body = bodyOf<{
      film_title?: unknown; format?: unknown; auditorium?: unknown;
      first_local?: unknown; weeks?: unknown;
    }>(req);
    const locale = req.scope?.locale ?? 'fr';
    const fields: Record<string, string> = {};
    const filmTitle = typeof body.film_title === 'string' ? body.film_title.trim() : '';
    const format = typeof body.format === 'string' ? body.format : '';
    const auditorium = typeof body.auditorium === 'string' ? body.auditorium : '';
    const firstLocal = typeof body.first_local === 'string' ? body.first_local : '';
    const weeks = typeof body.weeks === 'number' && Number.isInteger(body.weeks) ? body.weeks : 0;
    if (filmTitle.length < 1 || filmTitle.length > 120) fields.film_title = locale === 'en' ? 'Use 1 to 120 characters.' : 'Utilisez de 1 à 120 caractères.';
    if (!['35mm', '16mm', 'DCP'].includes(format)) fields.format = locale === 'en' ? 'Choose one of the listed options.' : "Choisissez l'une des options proposées.";
    if (!['MH1', 'MH2', 'AC1'].includes(auditorium)) fields.auditorium = locale === 'en' ? 'Choose one of the listed options.' : "Choisissez l'une des options proposées.";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(firstLocal)) fields.first_local = locale === 'en' ? 'Enter a valid date.' : 'Entrez une date valide.';
    if (weeks < 1 || weeks > 26) fields.weeks = locale === 'en' ? 'Choose one of the listed options.' : "Choisissez l'une des options proposées.";
    if (Object.keys(fields).length > 0) throw validationError(fields);
    const outcome = await addScreenings({
      slug: param(req, 'slug'),
      filmTitle,
      format,
      auditorium,
      firstLocal,
      weeks,
    });
    json(res, 201, outcome);
  }));

  router.post('/api/programmer/seasons/:slug/transition', handler(async (req, res) => {
    const programmer = req.scope?.requireRole('programmer');
    const body = bodyOf<{ to?: unknown; reason?: unknown }>(req);
    const to = body.to;
    if (to !== 'scheduled' && to !== 'archived' && to !== 'withdrawn') {
      throw validationError({ to: 'Choose one of the listed options.' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (to === 'withdrawn' && (reason.length < 3 || reason.length > 500)) {
      throw validationError({ reason: 'Use 3 to 500 characters.' });
    }
    if (to === 'withdrawn' && services.status.billingUp !== true) {
      throw new ApiError('billing_unavailable');
    }
    const outcome = await transitionSeason(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      param(req, 'slug'),
      to,
      reason,
      programmer!.email,
    );
    json(res, 200, {
      season: {
        ...outcome.season,
        title: req.scope?.locale === 'fr' ? outcome.season.title_fr : outcome.season.title_en,
      },
      refunded_bookings: outcome.refunded_bookings,
    });
  }));

  // ===== Finance =====
  router.get('/api/finance/lookup', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    const upper = q.toUpperCase();
    if (/^T-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(upper)) {
      const ticket = await query<{ booking_ref: string }>(
        'SELECT booking_ref FROM tickets WHERE upper(code) = $1',
        [upper],
      );
      if (ticket.rows.length === 0) throw notFoundError();
      const booking = await bookingByRef(ticket.rows[0].booking_ref);
      if (!booking) throw notFoundError();
      json(res, 200, await lookupBooking(booking.ref));
      return;
    }
    if (/^HB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(upper)) {
      const booking = await bookingByRef(q);
      if (!booking) throw notFoundError();
      json(res, 200, await lookupBooking(booking.ref));
      return;
    }
    if (/^HG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(upper)) {
      const gift = await query<{
        ref: string; tier: string; price_cents: number; recipient_name: string;
        recipient_email: string; state: string; redeemed_at: Date | null;
      }>(
        'SELECT ref, tier, price_cents, recipient_name, recipient_email, state, redeemed_at FROM gifts WHERE upper(ref) = $1',
        [upper],
      );
      if (gift.rows.length === 0) throw notFoundError();
      const g = gift.rows[0];
      json(res, 200, {
        kind: 'gift',
        gift: {
          ref: g.ref,
          tier: g.tier,
          price_cents: g.price_cents,
          currency: 'CAD',
          recipient_name: g.recipient_name,
          recipient_email: g.recipient_email,
          state: g.state,
          redeemed_at: g.redeemed_at ? g.redeemed_at.toISOString() : null,
        },
      });
      return;
    }
    if (/^A-\d{6}$/.test(upper)) {
      const account = await query<{ number: string; name: string; email: string; locale: string; role: string }>(
        'SELECT number, name, email, locale, role FROM accounts WHERE number = $1',
        [upper],
      );
      if (account.rows.length === 0) throw notFoundError();
      const a = account.rows[0];
      const membership = a.role === 'patron' ? await query(
        'SELECT tier, cadence, plan, state, started_on, charged_through, ends_on, pending_tier, pending_cadence, pending_effective_date FROM memberships WHERE account_id = (SELECT id FROM accounts WHERE number = $1)',
        [upper],
      ) : null;
      const credit = a.role === 'patron' ? await creditBalance(upper) : null;
      json(res, 200, {
        kind: 'account',
        account: {
          number: a.number,
          name: a.name,
          email: a.email,
          locale: a.locale,
          role: a.role,
          membership: membership && membership.rows.length > 0
            ? {
                tier: membership.rows[0].tier,
                cadence: membership.rows[0].cadence,
                plan: membership.rows[0].plan,
                state: 'active',
                started_on: membership.rows[0].started_on,
                charged_through: membership.rows[0].charged_through,
                ends_on: membership.rows[0].ends_on,
                pending_change: membership.rows[0].pending_tier
                  ? {
                      tier: membership.rows[0].pending_tier,
                      cadence: membership.rows[0].pending_cadence,
                      effective_date: membership.rows[0].pending_effective_date,
                    }
                  : null,
              }
            : null,
          credit_balance_cents: credit?.balance_cents ?? 0,
        },
        ledger: credit?.movements ?? [],
      });
      return;
    }
    throw notFoundError();
  }));

  router.post('/api/finance/bookings/:ref/refund', handler(async (req, res) => {
    const finance = req.scope?.requireRole('finance') as import('../../services/store').AccountRow;
    const body = bodyOf<{ reason?: unknown }>(req);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) {
      throw validationError({ reason: 'Use 3 to 500 characters.' });
    }
    const booking = await bookingByRef(param(req, 'ref'));
    if (!booking) throw notFoundError();
    const screening = await query<{ starts_at: Date }>(
      'SELECT starts_at FROM screenings WHERE id = $1',
      [booking.screening_id],
    );
    const outcome = await refundBooking(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      {
        ref: booking.ref,
        reason: 'box-office',
        actor: finance!.email,
        startsAt: DateTime.fromJSDate(screening.rows[0].starts_at),
      },
    );
    json(res, 200, { refund: outcome.refund, audit_id: outcome.audit_id });
  }));

  router.post('/api/finance/credits', handler(async (req, res) => {
    const finance = req.scope?.requireRole('finance');
    const body = bodyOf<{ account_number?: unknown; amount_cents?: unknown; reason?: unknown }>(req);
    const accountNumber = typeof body.account_number === 'string' ? body.account_number.trim() : '';
    const amount = typeof body.amount_cents === 'number' && Number.isInteger(body.amount_cents) ? body.amount_cents : 0;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) {
      throw validationError({ reason: 'Use 3 to 500 characters.' });
    }
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    const outcome = await issueGoodwillCredit(
      { cfg: services.cfg, kb: services.kb, outbox: services.outbox },
      { accountNumber, amountCents: amount, reason, actorEmail: finance!.email },
    );
    json(res, 201, outcome);
  }));

  router.get('/api/finance/audit', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    json(res, 200, { entries: await auditList() });
  }));

  router.put('/api/finance/audit/:id', rejectAuditEdit);
  router.patch('/api/finance/audit/:id', rejectAuditEdit);
  router.delete('/api/finance/audit/:id', rejectAuditEdit);

  router.get('/api/finance/reconciliation', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    const date = typeof req.query.date === 'string' ? req.query.date : DateTime.now().setZone(torontoTz).toFormat('yyyy-MM-dd');
    if (!dateRe.test(date)) throw validationError({ date: 'Enter a valid date.' });
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    json(res, 200, await reconciliationFor(services.kb, date));
  }));

  router.get('/api/finance/reconciliation.csv', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    const date = typeof req.query.date === 'string' ? req.query.date : DateTime.now().setZone(torontoTz).toFormat('yyyy-MM-dd');
    if (!dateRe.test(date)) throw validationError({ date: 'Enter a valid date.' });
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    const csv = await reconciliationCsv(services.kb, date);
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="halide-takings-${date}.csv"`);
    res.send(csv);
  }));

  router.post('/api/finance/reconciliation/accept', handler(async (req, res) => {
    const finance = req.scope?.requireRole('finance');
    const body = bodyOf<{ date?: unknown; reason?: unknown }>(req);
    const date = typeof body.date === 'string' ? body.date : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!dateRe.test(date)) throw validationError({ date: 'Enter a valid date.' });
    if (reason.length < 3 || reason.length > 500) {
      throw validationError({ reason: 'Use 3 to 500 characters.' });
    }
    if (services.status.billingUp !== true) throw new ApiError('billing_unavailable');
    json(res, 200, await acceptReconciliation(services.kb, date, reason, finance!.email));
  }));

  router.get('/api/finance/outbox', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    json(res, 200, { messages: await services.outbox.list() });
  }));

  router.get('/api/finance/enquiries', handler(async (req, res) => {
    req.scope?.requireRole('finance');
    json(res, 200, { enquiries: await listEnquiries() });
  }));

  router.post('/api/finance/enquiries/:ref/reply', handler(async (req, res) => {
    const finance = req.scope?.requireRole('finance');
    const body = bodyOf<{ body?: unknown }>(req);
    const replyBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (replyBody.length < 1 || replyBody.length > 4000) {
      throw validationError({ body: 'Use 1 to 4000 characters.' });
    }
    const outcome = await replyEnquiry(services.outbox, param(req, 'ref'), replyBody, finance!.email);
    json(res, 201, outcome);
  }));

  return router;
}

function rejectAuditEdit(req: Request, res: Response): void {
  const scope = (req as CookiedRequest).scope;
  if (!scope) return;
  try {
    scope.requireRole('finance');
  } catch (err) {
    // Auth errors surface with the normal shape; method_not_allowed comes
    // only after the auth checks.
    sendError(res, scope.locale, err as ApiErrorType);
    return;
  }
  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: { code: 'method_not_allowed', message: '' } });
}

async function lookupBooking(ref: string): Promise<Record<string, unknown>> {
  const booking = await bookingView(ref);
  const record = await bookingByRef(ref);
  if (!record) throw notFoundError();
  const patronRes = await query<{ name: string; email: string; number: string }>(
    `SELECT a.name, a.email, a.number FROM accounts a WHERE a.id = $1`,
    [record.account_id ?? 0],
  );
  const patron = patronRes.rows[0] ?? {
    name: '',
    email: '',
    number: '',
  };
  const guestRes = await query<{ guest_name: string | null; guest_email: string | null; guest_phone: string | null }>(
    'SELECT guest_name, guest_email, guest_phone FROM bookings WHERE ref = $1',
    [ref],
  );
  const guest = guestRes.rows[0] ?? { guest_name: null, guest_email: null, guest_phone: null };
  return {
    kind: 'booking',
    booking,
    patron: {
      name: patron.name || (guest.guest_name ?? ''),
      email: patron.email || (guest.guest_email ?? ''),
      phone: guest.guest_phone,
      account_number: patron.number || null,
    },
  };
}
