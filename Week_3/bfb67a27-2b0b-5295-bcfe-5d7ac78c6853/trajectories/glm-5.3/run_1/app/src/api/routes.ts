// Every API endpoint, with the published precedence enforced by one pipeline.

import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Request, RequestHandler, Response } from 'express';
import express from 'express';
import { pool, withTransaction } from '../db.js';
import {
  AppError,
  crossOrigin,
  errorBody,
  forbidden,
  mailUnavailable,
  paymentsUnavailable,
  stateConflict,
  storageUnavailable,
  tooLarge,
  unauthenticated,
  unitTaken,
  validation,
} from './errors.js';
import { MESSAGES, isDateString, validateDates, validEmail, validName, validMoneyCents } from './validate.js';
import { beginIdempotent, storeIdempotentResponse } from './idempotency.js';
import {
  IllegalMoveError,
  activeRateFor,
  freeSerialsForClass,
  kitFreeForDates,
  kitReadyToGo,
  loadAvailability,
  loadCatalogue,
  loadRateCards,
  moveUnit,
  unitHistory,
  unitLocations,
  utilisation,
} from '../domain/store.js';
import { billableDayBreakdown, formatCents, priceHire, todayUtc } from '../domain/pricing.js';
import { HOLD_SECONDS } from '../config.js';
import { bookingView } from './views.js';
import {
  checkinUnit,
  checkoutUnits,
  damageTotal,
  effectiveState,
  listBookings,
  loadBooking,
  loadBookingPhotos,
  loadLatestCertificate,
} from './bookings-store.js';
import type { Booking, Movement, RenterRole } from '../types.js';
import { BOOKING_STATES } from '../types.js';
import { transitionAllowed } from '../domain/states.js';
import { closeBlockers, checkoutBlockers } from '../domain/gates.js';
import { KillBillClient, centsToDollars, purchaseSucceeded } from '../providers/killbill.js';
import { StorageProvider, certificateKey, photoKey } from '../providers/storage.js';
import { Mailer } from '../providers/mail.js';
import { ProviderHealth } from '../providers/health.js';
import { createSession, destroySession, issueToken, sessionRole, storeSession } from './auth.js';
import { buildBookingViewContext } from './booking-context.js';

const UPLOAD_LIMIT = 5000000;

export interface ApiContext {
  killbill: KillBillClient;
  storage: StorageProvider;
  mailer: Mailer;
  health: ProviderHealth;
}

function renterKeyOf(req: Request): string | null {
  const header = req.headers['x-renter-key'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

async function staffOrRenterRole(req: Request, booking: Booking): Promise<RenterRole> {
  const staffRole = await sessionRole(req);
  if (staffRole !== null) {
    return staffRole;
  }
  const key = renterKeyOf(req);
  if (key !== null && key === booking.renterKey) {
    return 'renter';
  }
  throw new AppError(404, 'not_found', 'We could not find that booking');
}

interface RouteContext {
  req: Request;
  res: Response;
  today: string;
  now: Date;
}

type Handler = (ctx: RouteContext) => Promise<{ status: number; body: unknown }>;

function send(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function createApiRouter(context: ApiContext): RequestHandler {
  const router = express.Router();

  function guard(handler: Handler): RequestHandler {
    return async (req, res) => {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `${req.protocol}://${req.get('host')}`) {
        send(res, 403, errorBody(crossOrigin()));
        return;
      }
      try {
        const result = await handler({ req, res, today: todayUtc(new Date()), now: new Date() });
        if (result.status === 204) {
          res.status(204).end();
          return;
        }
        send(res, result.status, result.body);
      } catch (error) {
        if (error instanceof AppError) {
          send(res, error.status, errorBody(error));
          return;
        }
        const message = error instanceof Error ? error.message : 'Unexpected error';
        res.status(500).json({ error: { code: 'internal_error', message } });
      }
    };
  }

  function requireStaff(req: Request): Promise<'owner' | 'prep_tech'> {
    return sessionRole(req).then((role) => {
      if (role === null) {
        throw unauthenticated();
      }
      return role;
    });
  }

  function renterKey(req: Request): string | null {
    const header = req.headers['x-renter-key'];
    return typeof header === 'string' && header.length > 0 ? header : null;
  }

  function staffOrRenterRole(req: Request, booking: Booking): Promise<RenterRole> {
    return sessionRole(req).then((staffRole) => {
      if (staffRole !== null) {
        return staffRole;
      }
      if (renterKey(req) !== null && renterKey(req) === booking.renterKey) {
        return 'renter';
      }
      throw new AppError(404, 'not_found', 'We could not find that booking');
    });
  }

  // ---------- authentication ----------

  router.post('/session', guard(async ({ req, res }) => {
    const body = (req as Request & { parsedBody?: unknown }).parsedBody;
    const passcode = typeof (body as Record<string, unknown> | undefined)?.passcode === 'string'
      ? ((body as Record<string, unknown>).passcode as string)
      : '';
    const session = await createSession(passcode);
    if (session === null) {
      throw new AppError(401, 'invalid_passcode', "That passcode isn't recognised");
    }
    const token = issueToken();
    await storeSession(token, session.role);
    res.setHeader('Set-Cookie', `tallyslate_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    return { status: 200, body: { role: session.role } };
  }));

  router.get('/session', guard(async ({ req }) => {
    const role = await sessionRole(req);
    if (role === null) {
      throw unauthenticated();
    }
    return { status: 200, body: { role } };
  }));

  router.delete('/session', guard(async ({ req, res }) => {
    const role = await sessionRole(req);
    if (role === null) {
      throw unauthenticated();
    }
    await destroySession(req.cookies?.tallyslate_session ?? '');
    res.setHeader('Set-Cookie', 'tallyslate_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { status: 204, body: undefined };
  }));

  // ---------- health and status ----------

  router.get('/health', guard(async () => ({ status: 200, body: { status: 'ok' } })));

  router.get('/status', guard(async () => {
    const status = await context.health.status();
    return { status: 200, body: status };
  }));

  // ---------- kits and price ----------

  router.get('/kits', guard(async ({ req, today }) => {
    const dates = parseOptionalDates(req, today);
    const catalogue = await loadCatalogue();
    const availability = dates === null ? null : await loadAvailability();
    const locations = availability?.unitLocations ?? new Map<string, string>();
    const kits = [];
    for (const kit of catalogue.kits) {
      const classes = catalogue.classes.filter((klass) => klass.kitId === kit.id);
      const rate = await activeRateFor(kit.id, today);
      const price = dates !== null && rate !== null ? priceFor(dates, rate) : null;
      const freeForDates =
        dates !== null && availability !== null
          ? kitFreeForDates(kit, catalogue, availability, dates.pickupDate, dates.returnDate)
          : null;
      kits.push({
        id: kit.id,
        name: kit.name,
        category: kit.category,
        replacementValueCents: classes.reduce((sum, klass) => sum + klass.replacementValueCents, 0),
        dayRateCents: rate?.dayRateCents ?? null,
        depositCents: rate?.depositCents ?? null,
        rateCardVersion: rate?.version ?? null,
        readyToGo: kitReadyToGo(kit, catalogue, locations),
        freeForDates,
        price,
        components: classes.map((klass) => ({
          classId: klass.id,
          name: klass.name,
          replacementValueCents: klass.replacementValueCents,
        })),
      });
    }
    return { status: 200, body: { kits } };
  }));

  router.get('/kits/:kitId', guard(async ({ req, today }) => {
    const catalogue = await loadCatalogue();
    const kit = catalogue.kits.find((candidate) => candidate.id === req.params.kitId);
    if (kit === undefined) {
      throw new AppError(404, 'not_found', 'We could not find that kit');
    }
    const dates = parseOptionalDates(req, today);
    const classes = catalogue.classes.filter((klass) => klass.kitId === kit.id);
    const rate = await activeRateFor(kit.id, today);
    const availability = dates === null ? null : await loadAvailability();
    const locations = availability?.unitLocations ?? new Map<string, string>();
    const units = catalogue.units
      .filter((unit) => classes.some((klass) => klass.id === unit.classId))
      .map((unit) => {
        const location = locations.get(unit.serial);
        let status: 'free' | 'booked' | 'repair' | null = null;
        if (dates !== null && availability !== null) {
          status = unitStatus(unit.serial, dates, availability);
        }
        return { serial: unit.serial, classId: unit.classId, location: location ?? null, status };
      });
    const freeForDates =
      dates !== null && availability !== null
        ? kitFreeForDates(kit, catalogue, availability, dates.pickupDate, dates.returnDate)
        : null;
    const price = dates !== null && rate !== null ? priceFor(dates, rate) : null;
    return {
      status: 200,
      body: {
        id: kit.id,
        name: kit.name,
        category: kit.category,
        replacementValueCents: classes.reduce((sum, klass) => sum + klass.replacementValueCents, 0),
        dayRateCents: rate?.dayRateCents ?? null,
        depositCents: rate?.depositCents ?? null,
        rateCardVersion: rate?.version ?? null,
        readyToGo: kitReadyToGo(kit, catalogue, locations),
        freeForDates,
        price,
        components: classes.map((klass) => ({
          classId: klass.id,
          name: klass.name,
          replacementValueCents: klass.replacementValueCents,
        })),
        units,
      },
    };
  }));

  router.get('/price', guard(async ({ req, today }) => {
    const kitId = req.query.kitId;
    if (typeof kitId !== 'string') {
      throw validation({ kitId: 'Pick a kit' });
    }
    const catalogue = await loadCatalogue();
    const kit = catalogue.kits.find((candidate) => candidate.id === kitId);
    if (kit === undefined) {
      throw new AppError(404, 'not_found', 'We could not find that kit');
    }
    const parsed = requireDates(req, today);
    const rate = await activeRateFor(kitId, today);
    if (rate === null) {
      throw new AppError(404, 'not_found', 'We could not find that kit');
    }
    const breakdown = billableDayBreakdown(parsed.pickupDate, parsed.returnDate);
    const priced = priceHire(parsed.pickupDate, parsed.returnDate, {
      dayRateCents: rate.dayRateCents,
      depositCents: rate.depositCents,
    });
    return {
      status: 200,
      body: {
        kitId,
        pickupDate: parsed.pickupDate,
        returnDate: parsed.returnDate,
        hireDays: breakdown.hireDays,
        billableDays: priced.billableDays,
        dayRateCents: priced.dayRateCents,
        hirePriceCents: priced.hirePriceCents,
        depositCents: priced.depositCents,
        totalCents: priced.totalCents,
        rateCardVersion: rate.version,
        days: breakdown.days,
      },
    };
  }));

  // ---------- bookings ----------

  router.get('/bookings', guard(async ({ req }) => {
    await requireStaff(req);
    const state = req.query.state;
    let states: string[];
    if (typeof state === 'string') {
      if (!BOOKING_STATES.includes(state as Booking['state'])) {
        throw validation({ state: 'Unknown booking state' });
      }
      states = [state];
    } else {
      states = [...BOOKING_STATES];
    }
    const bookings = await listBookings(states);
    const views = [];
    for (const booking of bookings) {
      const effective = await effectiveState(booking, new Date());
      views.push(bookingView(effective, await buildBookingViewContext(effective, new Date())));
    }
    return { status: 200, body: { bookings: views } };
  }));

  router.get('/bookings/:ref', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    if (role === null) {
      throw unauthenticated();
    }
    const effective = await effectiveState(booking, new Date());
    return {
      status: 200,
      body: bookingView(effective, await buildBookingViewContext(effective, new Date())),
    };
  }));

  router.post('/bookings', guard(async ({ req, today }) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
    const idempotencyKey = headerOrNull(req, 'idempotency-key');
    const endpoint = 'POST /api/bookings';
    const path = '/api/bookings';
    const body = parsedObject(req);
    const kitId = typeof body.kitId === 'string' ? body.kitId : '';
    const catalogue = await loadCatalogue();
    const kit = catalogue.kits.find((candidate) => candidate.id === kitId);
    const rawDates = validateDates(body.pickupDate, body.returnDate, today);
    const dates: { pickupDate: string; returnDate: string } = 'error' in rawDates
      ? { pickupDate: '', returnDate: '' }
      : rawDates;
    const datesError = 'error' in rawDates ? rawDates.error : null;
    const renter = (body.renter ?? {}) as Record<string, unknown>;
    const requestedUnits = (body.units ?? {}) as Record<string, string>;

    return await withTransaction(async (client) => {
      if (idempotencyKey === null) {
        throw validation({ idempotencyKey: MESSAGES.idempotencyKey });
      }
      const begun = await beginIdempotent(client, endpoint, path, idempotencyKey, raw);
      if (begun.kind === 'replay') {
        return { status: begun.response.status, body: JSON.parse(begun.response.body.toString('utf8')) };
      }
      if (kit === undefined) {
        throw new AppError(404, 'not_found', 'We could not find that kit');
      }
      const fields: Record<string, string> = {};
      if (datesError !== null) {
        fields[datesError] = datesError === 'pickupDate' ? MESSAGES.pickupDate : MESSAGES.returnDate;
      }
      if (!validName(renter.name)) {
        fields['renter.name'] = MESSAGES.renterName;
      }
      if (!validEmail(renter.email)) {
        fields['renter.email'] = MESSAGES.renterEmail;
      }
      if (Object.keys(fields).length > 0) {
        throw validation(fields);
      }
      const classes = catalogue.classes.filter((klass) => klass.kitId === kit.id);
      const assigned: { serial: string; classId: string }[] = [];
      let conflict: { serial: string | null; nextFreeSerial: string | null } | null = null;
      const allSerials = catalogue.units
        .filter((unit) => classes.some((klass) => klass.id === unit.classId))
        .map((unit) => unit.serial)
        .sort();
      // Claims are decided one at a time per unit: lock every candidate row before deciding.
      await client.query('SELECT 1 FROM serial_units WHERE serial = ANY($1) FOR UPDATE', [allSerials]);
      const availability = await currentAvailability(client);
      for (const klass of classes) {
        const requested = requestedUnits[klass.id];
        const candidates = freeSerialsForClass(
          klass.id,
          catalogue,
          availability,
          dates.pickupDate,
          dates.returnDate,
          null,
        );
        const belongs =
          typeof requested === 'string' &&
          catalogue.units.some((unit) => unit.serial === requested && unit.classId === klass.id);
        if (requested !== undefined && !belongs) {
          throw validation({ units: MESSAGES.units });
        }
        if (requested !== undefined && belongs) {
          if (!candidates.includes(requested)) {
            conflict = conflict ?? {
              serial: requested,
              nextFreeSerial: candidates.length > 0 ? candidates[0] : null,
            };
            continue;
          }
          assigned.push({ serial: requested, classId: klass.id });
        } else {
          if (candidates.length === 0) {
            conflict = conflict ?? { serial: null, nextFreeSerial: null };
            continue;
          }
          assigned.push({ serial: candidates[0], classId: klass.id });
        }
      }
      if (conflict !== null) {
        throw unitTaken(conflict.serial, conflict.nextFreeSerial);
      }
      const rate = await activeRateFor(kit.id, today);
      if (rate === null) {
        throw new AppError(404, 'not_found', 'We could not find that kit');
      }
      const priced = priceHire(dates.pickupDate, dates.returnDate, {
        dayRateCents: rate.dayRateCents,
        depositCents: rate.depositCents,
      });
      const breakdown = billableDayBreakdown(dates.pickupDate, dates.returnDate);
      const refResult = await client.query<{ ref: string }>(
        "SELECT 'NB-' || (10000 + nextval('booking_ref_seq'))::text AS ref",
      );
      const ref = refResult.rows[0].ref;
      const renterKey = randomUUID();
      const holdExpiresAt = new Date(Date.now() + HOLD_SECONDS * 1000);
      await client.query(
        `INSERT INTO bookings (ref, state, kit_id, pickup_date, return_date, hire_days, billable_days,
            day_rate_cents, hire_price_cents, deposit_cents, total_cents, rate_card_version,
            renter_name, renter_email, renter_key, hold_expires_at, payment_status)
         VALUES ($1, 'quote', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'none')`,
        [
          ref,
          kit.id,
          dates.pickupDate,
          dates.returnDate,
          breakdown.hireDays,
          priced.billableDays,
          priced.dayRateCents,
          priced.hirePriceCents,
          priced.depositCents,
          priced.totalCents,
          rate.version,
          (renter.name as string).trim(),
          (renter.email as string).trim(),
          renterKey,
          holdExpiresAt,
        ],
      );
      for (const unit of assigned) {
        await client.query('INSERT INTO booking_units (ref, serial, class_id) VALUES ($1, $2, $3)', [
          ref,
          unit.serial,
          unit.classId,
        ]);
      }
      const booking = await loadBookingRow(client, ref);
      const view = await bookingViewAsync(booking);
      const responseBody = JSON.stringify({ booking: view, renterKey });
      await storeIdempotentResponse(client, endpoint, idempotencyKey, path, begun.bodyHash, 201, responseBody);
      return { status: 201, body: { booking: view, renterKey } };
    });
  }));

  // ---------- certificate upload ----------

  router.post('/bookings/:ref/certificate', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const effective = await effectiveState(booking, new Date());
    if (!transitionAllowed('upload_certificate', effective.state, role)) {
      if (role === 'renter') {
        throw stateConflict(effective.ref, effective.state);
      }
      throw forbidden();
    }
    const upload = (req as Request & { upload?: { file?: Uint8Array } }).upload;
    const file = upload?.file;
    if (file === undefined) {
      throw validation({ file: 'Upload the certificate as a PDF' });
    }
    if (file.length > UPLOAD_LIMIT) {
      throw tooLarge();
    }
    if (!(file[0] === 0x25 && file[1] === 0x50 && file[2] === 0x44 && file[3] === 0x46 && file[4] === 0x2d)) {
      throw validation({ file: 'Upload the certificate as a PDF' });
    }
    const certificateId = randomUUID();
    const key = certificateKey(booking.ref, certificateId);
    const stored = await context.storage.put(key, file, 'application/pdf');
    if (!stored.ok) {
      context.health.markStorageDown();
      throw storageUnavailable();
    }
    await pool.query(
      `INSERT INTO certificates (id, ref, status, uploaded_at, size_bytes, storage_key)
       VALUES ($1, $2, 'pending_review', now(), $3, $4)`,
      [certificateId, booking.ref, file.length, key],
    );
    const fresh = await loadBooking(booking.ref);
    if (fresh === null) {
      throw new Error('booking vanished');
    }
    return {
      status: 201,
      body: bookingView(fresh, await buildBookingViewContext(fresh, new Date())),
    };
  }));

  router.get('/certificates', guard(async ({ req }) => {
    await requireOwner(req);
    const status = req.query.status;
    const rows =
      typeof status === 'string'
        ? await pool.query(
            `SELECT id, ref AS "bookingRef", status, uploaded_at AS "uploadedAt", size_bytes AS "sizeBytes"
               FROM certificates WHERE status = $1 ORDER BY uploaded_at`,
            [status],
          )
        : await pool.query(
            `SELECT id, ref AS "bookingRef", status, uploaded_at AS "uploadedAt", size_bytes AS "sizeBytes"
               FROM certificates ORDER BY uploaded_at`,
          );
    return { status: 200, body: { certificates: rows.rows } };
  }));

  router.get('/certificates/:id/file', guard(async ({ req, res }) => {
    await requireOwner(req);
    const result = await pool.query<{ storage_key: string }>(
      'SELECT storage_key AS storage_key FROM certificates WHERE id = $1',
      [req.params.id],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'not_found', 'We could not find that certificate');
    }
    const fetched = await context.storage.get(result.rows[0].storage_key);
    if (!fetched.ok) {
      context.health.markStorageDown();
      throw storageUnavailable();
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(fetched.value));
    return { status: 200, body: undefined };
  }));

  router.post('/certificates/:id/review', guard(async ({ req }) => {
    await requireOwner(req);
    const result = await pool.query(
      'SELECT id, ref, status FROM certificates WHERE id = $1 FOR UPDATE',
      [req.params.id],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'not_found', 'We could not find that certificate');
    }
    const record = result.rows[0] as { id: string; ref: string; status: string };
    if (record.status !== 'pending_review') {
      throw stateConflict(record.ref, record.status);
    }
    const body = parsedObject(req);
    const fields: Record<string, string> = {};
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      fields.decision = 'Decide to approve or reject';
    }
    if (body.decision === 'approve') {
      const coverageStart = isDateString(body.coverageStart) ? body.coverageStart : null;
      const coverageEnd = isDateString(body.coverageEnd) ? body.coverageEnd : null;
      if (coverageStart === null) {
        fields.coverageStart = 'Give the cover start date';
      }
      if (coverageEnd === null) {
        fields.coverageEnd = 'Give the cover end date';
      }
      if (coverageStart !== null && coverageEnd !== null && coverageEnd < coverageStart) {
        fields.coverageEnd = 'Cover must end on or after it starts';
      }
      if (!validMoneyCents(body.limitCents)) {
        fields.limitCents = MESSAGES.money;
      }
      if (body.lossPayeeNamed !== true) {
        fields.lossPayeeNamed = 'The certificate must name Northbar Camera Hire as loss payee';
      }
    }
    if (body.decision === 'reject') {
      const reason = body.reason;
      if (typeof reason !== 'string' || reason.trim().length < 1 || reason.length > 300) {
        fields.reason = 'Give a reason of 1 to 300 characters';
      }
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    if (body.decision === 'approve') {
      const coverageStart = isDateString(body.coverageStart) ? body.coverageStart : null;
      const coverageEnd = isDateString(body.coverageEnd) ? body.coverageEnd : null;
      await pool.query(
        `UPDATE certificates SET status = 'approved', coverage_start = $2, coverage_end = $3,
            limit_cents = $4, loss_payee_named = true, reviewed_at = now()
          WHERE id = $1`,
        [record.id, coverageStart, coverageEnd, body.limitCents],
      );
    } else {
      await pool.query(
        `UPDATE certificates SET status = 'rejected', reason = $2, reviewed_at = now()
          WHERE id = $1`,
        [record.id, (body.reason as string).trim()],
      );
      const booking = await loadBooking(record.ref);
      if (booking !== null) {
        const mail = await context.mailer.send(
          booking.renterEmail,
          `Certificate not accepted · ${booking.ref}`,
          `Reason: ${(body.reason as string).trim()}`,
        );
        if (!mail.ok) {
          // the review stands; the renter learns of the rejection on the booking page
        }
      }
    }
    const fresh = await loadBooking(record.ref);
    if (fresh === null) {
      throw new Error('booking vanished');
    }
    return { status: 200, body: bookingView(fresh, await buildBookingViewContext(fresh, new Date())) };
  }));

  // ---------- confirm and cancel ----------

  router.post('/bookings/:ref/confirm', guard(async ({ req }) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
    const idempotencyKey = headerOrNull(req, 'idempotency-key');
    const endpoint = 'POST /api/bookings/confirm';
    const path = `/api/bookings/${req.params.ref}/confirm`;
    const stored = await replayOrFresh(idempotencyKey, endpoint, path, raw);
    if (stored !== null) {
      return stored;
    }
    const outcome = await confirmBooking(req, context);
    await recordIdempotent(idempotencyKey, endpoint, path, raw, outcome.status, JSON.stringify(outcome.body));
    return outcome;
  }));

  router.post('/bookings/:ref/cancel', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const fresh = await effectiveState(booking, new Date());
    if (!transitionAllowed('cancel', fresh.state, role)) {
      if (role === 'renter' || role === 'owner') {
        throw stateConflict(fresh.ref, fresh.state);
      }
      throw forbidden();
    }
    const paid = fresh.paymentStatus === 'paid';
    if (paid) {
      const account = await ensureKillBillAccount(context, fresh);
      if (account === null) {
        context.health.markPaymentsDown();
        throw paymentsUnavailable();
      }
      const payment = await context.killbill.findPayment(fresh.ref);
      if (!payment.ok) {
        context.health.markPaymentsDown();
        throw paymentsUnavailable();
      }
      if (payment.value === null) {
        throw stateConflict(fresh.ref, fresh.state);
      }
      const refund = await context.killbill.refund(
        payment.value.paymentId,
        fresh.ref,
        centsToDollars(fresh.totalCents),
        'cancel',
      );
      if (!refund.ok) {
        context.health.markPaymentsDown();
        throw paymentsUnavailable();
      }
    }
    await pool.query(
      `UPDATE bookings SET state = 'cancelled', cancelled_at = now(),
          payment_status = CASE WHEN $2::boolean THEN 'refunded' ELSE payment_status END,
          refund_cents = CASE WHEN $2::boolean THEN total_cents ELSE refund_cents END
        WHERE ref = $1`,
      [fresh.ref, paid],
    );
    const updated = await loadBooking(fresh.ref);
    if (updated === null) {
      throw new Error('booking vanished');
    }
    return { status: 200, body: bookingView(updated, await buildBookingViewContext(updated, new Date())) };
  }));

  // ---------- swap and prep ----------

  router.post('/bookings/:ref/swap', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const body = parsedObject(req);
    const from = body.from;
    const to = body.to;
    if (typeof from !== 'string' || !booking.units.some((unit) => unit.serial === from)) {
      throw validation({ from: `${from} is not on this booking` });
    }
    const catalogue = await loadCatalogue();
    const fromClass = booking.units.find((unit) => unit.serial === from)?.classId ?? '';
    if (
      typeof to !== 'string' ||
      booking.units.some((unit) => unit.serial === to) ||
      !catalogue.units.some((unit) => unit.serial === to && unit.classId === fromClass)
    ) {
      throw validation({ to: 'Pick a unit of the same class' });
    }
    const fresh = await effectiveState(booking, new Date());
    if (!transitionAllowed('swap', fresh.state, role)) {
      throw stateConflict(fresh.ref, fresh.state);
    }
    return await withTransaction(async (client) => {
      await client.query('SELECT 1 FROM serial_units WHERE serial = ANY($1) FOR UPDATE', [[from, to].sort()]);
      const availability = await currentAvailability(client);
      const candidates = freeSerialsForClass(
        fromClass,
        catalogue,
        availability,
        fresh.pickupDate,
        fresh.returnDate,
        fresh.ref,
      );
      if (!candidates.includes(to)) {
        const nextFree = candidates.length > 0 ? candidates[0] : null;
        throw unitTaken(to, nextFree);
      }
      await client.query('UPDATE booking_units SET serial = $2 WHERE ref = $1 AND serial = $3', [
        fresh.ref,
        to,
        from,
      ]);
      const updated = await loadBookingRow(client, fresh.ref);
      return { status: 200, body: bookingView(updated, await buildBookingViewContext(updated, new Date())) };
    });
  }));

  router.post('/bookings/:ref/prep', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const fresh = await effectiveState(booking, new Date());
    if (!transitionAllowed('prep', fresh.state, role)) {
      throw stateConflict(fresh.ref, fresh.state);
    }
    const locations = await unitLocations();
    const missing = fresh.units
      .filter((unit) => locations.get(unit.serial) !== 'shelf')
      .map((unit) => unit.serial);
    if (missing.length > 0) {
      throw new AppError(409, 'unit_not_on_shelf', `${missing.join(', ')} not on the shelf`, undefined, {
        serials: missing,
      });
    }
    await pool.query("UPDATE bookings SET state = 'prepped' WHERE ref = $1", [fresh.ref]);
    const updated = await loadBooking(fresh.ref);
    if (updated === null) {
      throw new Error('booking vanished');
    }
    return { status: 200, body: bookingView(updated, await buildBookingViewContext(updated, new Date())) };
  }));

  // ---------- photos ----------

  router.post('/bookings/:ref/photos', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const upload = (req as Request & { upload?: { phase?: string; serial?: string; file?: Uint8Array } }).upload;
    const fields: Record<string, string> = {};
    const phase = upload?.phase;
    if (phase !== 'checkout' && phase !== 'checkin') {
      fields.phase = 'Pick a phase of checkout or checkin';
    }
    const serial = typeof upload?.serial === 'string' ? upload.serial : null;
    if (serial === null || !booking.units.some((unit) => unit.serial === serial)) {
      if (serial !== null) {
        throw validation({ serial: `${serial} is not on this booking` });
      }
      fields.serial = 'Scan a unit on this booking';
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    const fresh = await effectiveState(booking, new Date());
    const transition = phase === 'checkout' ? 'checkout_photo' : 'checkin_photo';
    if (!transitionAllowed(transition, fresh.state, role)) {
      throw stateConflict(fresh.ref, fresh.state);
    }
    const file = upload?.file;
    if (file === undefined) {
      throw validation({ file: 'Attach a JPEG or PNG photo' });
    }
    if (file.length > UPLOAD_LIMIT) {
      throw tooLarge();
    }
    const isJpeg = file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
    const isPng = file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47;
    if (!isJpeg && !isPng) {
      throw validation({ file: 'Attach a JPEG or PNG photo' });
    }
    const photoId = randomUUID();
    const extension = isJpeg ? 'jpg' : 'png';
    const phaseValue: 'checkout' | 'checkin' = phase === 'checkout' ? 'checkout' : 'checkin';
    const serialValue = serial as string;
    const key = photoKey(fresh.ref, phaseValue, serialValue, photoId, extension);
    await pool.query(
      `INSERT INTO photos (id, ref, phase, serial, status, uploaded_at) VALUES ($1, $2, $3, $4, 'pending', now())`,
      [photoId, fresh.ref, phaseValue, serialValue],
    );
    const stored = await context.storage.put(key, file, isJpeg ? 'image/jpeg' : 'image/png');
    const status = stored.ok ? 'stored' : 'failed';
    await pool.query('UPDATE photos SET status = $2, storage_key = $3 WHERE id = $1', [
      photoId,
      status,
      stored.ok ? key : null,
    ]);
    if (!stored.ok) {
      context.health.markStorageDown();
    }
    return {
      status: 201,
      body: { id: photoId, phase: phaseValue, serial: serialValue, status, key: stored.ok ? key : null },
    };
  }));

  // ---------- checkout ----------

  router.post('/bookings/:ref/checkout', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const fresh = await effectiveState(booking, new Date());
    if (!transitionAllowed('checkout', fresh.state, role)) {
      throw stateConflict(fresh.ref, fresh.state);
    }
    const body = parsedObject(req);
    const requestedUnits = Array.isArray(body.units) ? (body.units as Record<string, unknown>[]) : null;
    if (requestedUnits === null || requestedUnits.length !== fresh.units.length) {
      throw validation({ units: 'List every unit on this booking once' });
    }
    const seen = new Set<string>();
    const fields: Record<string, string> = {};
    for (const requested of requestedUnits) {
      const serial = requested.serial;
      if (typeof serial !== 'string' || !fresh.units.some((unit) => unit.serial === serial) || seen.has(serial)) {
        throw validation({ units: 'List every unit on this booking once' });
      }
      seen.add(serial);
      const checklist = requested.checklist as Record<string, unknown> | undefined;
      if (
        checklist === undefined ||
        checklist.powersOn !== true ||
        checklist.accessoriesPresent !== true ||
        checklist.cosmeticOk !== true
      ) {
        fields.checklist = 'Every check must be ticked';
      }
      if (typeof requested.notes === 'string' && requested.notes.length > 500) {
        fields.notes = 'Keep the notes to 500 characters';
      }
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    const photos = await loadBookingPhotos(fresh.ref);
    const storedCheckoutPhotos = new Set(
      photos.filter((photo) => photo.phase === 'checkout' && photo.status === 'stored').map((photo) => photo.serial),
    );
    const missingPhotos = fresh.units
      .filter((unit) => !storedCheckoutPhotos.has(unit.serial))
      .map((unit) => unit.serial);
    if (missingPhotos.length > 0) {
      throw new AppError(409, 'photos_not_stored', 'Condition photos are not stored', undefined, {
        serials: missingPhotos,
      });
    }
    const certificate = await loadLatestCertificate(fresh.ref);
    const replacementValue = await replacementValueOf(fresh);
    const locations = await unitLocations();
    const unitsOnShelf = fresh.units.every((unit) => locations.get(unit.serial) === 'shelf');
    const blockers = checkoutBlockers(fresh, certificate, replacementValue, unitsOnShelf);
    if (blockers.length > 0) {
      throw new AppError(409, 'checkout_blocked', 'Checkout is blocked', undefined, { blockers });
    }
    await withTransaction(async (client) => {
      await client.query('SELECT 1 FROM bookings WHERE ref = $1 FOR UPDATE', [fresh.ref]);
      const state = await client.query<{ state: string }>('SELECT state FROM bookings WHERE ref = $1', [fresh.ref]);
      if (state.rows[0].state !== 'prepped') {
        throw stateConflict(fresh.ref, state.rows[0].state);
      }
      for (const requested of requestedUnits) {
        await client.query(
          'UPDATE booking_units SET checked_out_at = now(), checkout_notes = $3 WHERE ref = $1 AND serial = $2',
          [fresh.ref, requested.serial, typeof requested.notes === 'string' ? requested.notes : ''],
        );
      }
      await checkoutUnits(client, fresh.ref, [...seen]);
      await client.query("UPDATE bookings SET state = 'out' WHERE ref = $1", [fresh.ref]);
    });
    const updated = await loadBooking(fresh.ref);
    if (updated === null) {
      throw new Error('booking vanished');
    }
    return { status: 200, body: bookingView(updated, await buildBookingViewContext(updated, new Date())) };
  }));

  // ---------- check-in ----------

  router.post('/bookings/:ref/checkin', guard(async ({ req }) => {
    const booking = await loadBooking(req.params.ref);
    if (booking === null) {
      throw new AppError(404, 'not_found', 'We could not find that booking');
    }
    const role = await staffOrRenterRole(req, booking);
    const fresh = await effectiveState(booking, new Date());
    const body = parsedObject(req);
    const fields: Record<string, string> = {};
    const serial = body.serial;
    if (typeof serial !== 'string' || !fresh.units.some((unit) => unit.serial === serial)) {
      if (typeof serial === 'string') {
        throw validation({ serial: `${serial} is not on this booking` });
      }
      fields.serial = 'Scan a unit on this booking';
    }
    const condition = body.condition === 'ok' || body.condition === 'damaged' ? body.condition : null;
    if (condition === null) {
      fields.condition = 'Mark the unit OK or Damaged';
    }
    const damageChargeCents = body.damageChargeCents;
    if (condition === 'damaged') {
      if (typeof damageChargeCents !== 'number' || !Number.isInteger(damageChargeCents) || damageChargeCents < 0 || damageChargeCents > fresh.depositCents) {
        fields.damageChargeCents = `Damage charges cannot exceed the ${formatCents(fresh.depositCents)} deposit`;
      }
    } else if (damageChargeCents !== undefined && damageChargeCents !== 0) {
      fields.damageChargeCents = 'Only damaged units carry a charge';
    }
    if (typeof body.notes === 'string' && body.notes.length > 500) {
      fields.notes = 'Keep the notes to 500 characters';
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    if (!transitionAllowed('checkin_unit', fresh.state, role)) {
      const already = fresh.units.find((unit) => unit.serial === serial);
      if (fresh.state === 'out' && already !== undefined && already.checkedInAt !== null) {
        throw new AppError(409, 'unit_already_returned', `${serial} is already checked in`);
      }
      throw stateConflict(fresh.ref, fresh.state);
    }
    const charge = condition === 'damaged' && typeof damageChargeCents === 'number' ? damageChargeCents : 0;
    const damageTotalAfter = (await damageTotal(fresh.ref)) + charge;
    if (damageTotalAfter > fresh.depositCents) {
      throw validation({
        damageChargeCents: `Damage charges cannot exceed the ${formatCents(fresh.depositCents)} deposit`,
      });
    }
    const conditionValue = condition as 'ok' | 'damaged';
    await withTransaction(async (client) => {
      await client.query('SELECT 1 FROM bookings WHERE ref = $1 FOR UPDATE', [fresh.ref]);
      const state = await client.query<{ state: string }>('SELECT state FROM bookings WHERE ref = $1', [fresh.ref]);
      if (state.rows[0].state !== 'out') {
        const alreadyChecked = await client.query<{ checked_in_at: Date | null }>(
          'SELECT checked_in_at FROM booking_units WHERE ref = $1 AND serial = $2',
          [fresh.ref, serial],
        );
        if (alreadyChecked.rowCount !== 0 && alreadyChecked.rows[0].checked_in_at !== null) {
          throw new AppError(409, 'unit_already_returned', `${serial} is already checked in`);
        }
        throw stateConflict(fresh.ref, state.rows[0].state);
      }
      await checkinUnit(client, fresh.ref, serial as string, conditionValue, charge, typeof body.notes === 'string' ? body.notes : '');
      const remaining = await client.query<{ remaining: number }>(
        'SELECT COUNT(*)::int AS remaining FROM booking_units WHERE ref = $1 AND checked_in_at IS NULL',
        [fresh.ref],
      );
      if (remaining.rows[0].remaining === 0) {
        await client.query("UPDATE bookings SET state = 'returned' WHERE ref = $1", [fresh.ref]);
      }
    });
    const updated = await loadBooking(fresh.ref);
    if (updated === null) {
      throw new Error('booking vanished');
    }
    return { status: 200, body: bookingView(updated, await buildBookingViewContext(updated, new Date())) };
  }));

  // ---------- close ----------

  router.post('/bookings/:ref/close', guard(async ({ req }) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
    const idempotencyKey = headerOrNull(req, 'idempotency-key');
    const endpoint = 'POST /api/bookings/close';
    const path = `/api/bookings/${req.params.ref}/close`;
    const stored = await replayOrFresh(idempotencyKey, endpoint, path, raw);
    if (stored !== null) {
      return stored;
    }
    const outcome = await closeBooking(req, context);
    await recordIdempotent(idempotencyKey, endpoint, path, raw, outcome.status, JSON.stringify(outcome.body));
    return outcome;
  }));

  // ---------- units and house ----------

  router.post('/units/:serial/moves', guard(async ({ req }) => {
    await requireStaff(req);
    const body = parsedObject(req);
    const to = body.to;
    if (to !== 'repair' && to !== 'shelf') {
      throw validation({ to: 'Move the unit to repair or the shelf' });
    }
    const serial = req.params.serial;
    const catalogue = await loadCatalogue();
    if (!catalogue.units.some((unit) => unit.serial === serial)) {
      throw new AppError(404, 'not_found', 'We could not find that unit');
    }
    try {
      if (to === 'repair') {
        await moveUnit(serial, 'to_repair', 'shelf', 'repair', null);
        const movement = await latestMovement(serial, 'to_repair');
        return { status: 201, body: { serial, location: 'repair', movement } };
      }
      await moveUnit(serial, 'from_repair', 'repair', 'shelf', null);
      const movement = await latestMovement(serial, 'from_repair');
      return { status: 201, body: { serial, location: 'shelf', movement } };
    } catch (error) {
      if (error instanceof IllegalMoveError) {
        throw new AppError(409, 'illegal_move', error.message);
      }
      throw error;
    }
  }));

  router.get('/units/:serial/history', guard(async ({ req }) => {
    await requireStaff(req);
    const serial = req.params.serial;
    const history = await unitHistory(serial);
    if (history === null) {
      throw new AppError(404, 'not_found', 'We could not find that unit');
    }
    const balances: Record<string, number> = {};
    for (const [location, sum] of history.balances) {
      balances[location] = sum;
    }
    return {
      status: 200,
      body: {
        serial,
        classId: (await loadCatalogue()).units.find((unit) => unit.serial === serial)?.classId ?? '',
        location: history.location,
        movements: history.movements.map(movementEntryView),
        balances,
      },
    };
  }));

  router.get('/utilisation', guard(async ({ req }) => {
    await requireOwner(req);
    const catalogue = await loadCatalogue();
    const locations = await unitLocations();
    const totals = utilisation(catalogue, locations);
    const kits = catalogue.kits.map((kit) => ({
      kitId: kit.id,
      readyToGo: kitReadyToGo(kit, catalogue, locations),
    }));
    return { status: 200, body: { ...totals, kits } };
  }));

  router.get('/rate-cards', guard(async ({ req }) => {
    await requireStaff(req);
    const cards = await loadRateCards();
    const active = await activeRateVersion();
    return { status: 200, body: { activeVersion: active, rateCards: cards } };
  }));

  router.post('/rate-cards', guard(async ({ req, today }) => {
    await requireOwner(req);
    const body = parsedObject(req);
    const fields: Record<string, string> = {};
    const effectiveDate = isDateString(body.effectiveDate) ? body.effectiveDate : null;
    if (effectiveDate === null || effectiveDate < today) {
      fields.effectiveDate = 'Effective date must be today or later';
    }
    const catalogue = await loadCatalogue();
    const ratesInput = Array.isArray(body.rates) ? (body.rates as Record<string, unknown>[]) : [];
    const byKit = new Map<string, { dayRateCents: unknown; depositCents: unknown }>();
    for (const rate of ratesInput) {
      if (typeof rate.kitId === 'string') {
        byKit.set(rate.kitId, {
          dayRateCents: rate.dayRateCents,
          depositCents: rate.depositCents,
        });
      }
    }
    const rates: { kitId: string; dayRateCents: number; depositCents: number }[] = [];
    for (const kit of catalogue.kits) {
      const rate = byKit.get(kit.id);
      if (
        rate === undefined ||
        !validMoneyCents(rate.dayRateCents) ||
        !validMoneyCents(rate.depositCents)
      ) {
        fields.rates = 'Give a day rate and deposit for every kit';
        break;
      }
      rates.push({
        kitId: kit.id,
        dayRateCents: rate.dayRateCents as number,
        depositCents: rate.depositCents as number,
      });
    }
    if (Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    const card = await withTransaction(async (client) => {
      const next = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM rate_cards',
      );
      const version = next.rows[0].next;
      await client.query(
        'INSERT INTO rate_cards (version, effective_date, published_at) VALUES ($1, $2, now())',
        [version, effectiveDate],
      );
      for (const rate of rates) {
        await client.query(
          'INSERT INTO rates (kit_id, version, day_rate_cents, deposit_cents) VALUES ($1, $2, $3, $4)',
          [rate.kitId, version, rate.dayRateCents, rate.depositCents],
        );
      }
      return {
        version,
        effectiveDate,
        publishedAt: new Date().toISOString(),
        rates,
      };
    });
    return { status: 201, body: card };
  }));

  return router;
}

function priceFor(
  dates: { pickupDate: string; returnDate: string },
  rate: { dayRateCents: number; depositCents: number },
): { billableDays: number; hirePriceCents: number } {
  const priced = priceHire(dates.pickupDate, dates.returnDate, rate);
  return { billableDays: priced.billableDays, hirePriceCents: priced.hirePriceCents };
}

function unitStatus(
  serial: string,
  dates: { pickupDate: string; returnDate: string },
  availability: { holdings: { serial: string; pickupDate: string; returnDate: string }[]; unitLocations: Map<string, string> },
): 'free' | 'booked' | 'repair' {
  const location = availability.unitLocations.get(serial);
  if (location === 'repair') {
    return 'repair';
  }
  const held = availability.holdings.some(
    (holding) =>
      holding.serial === serial &&
      holding.pickupDate <= dates.returnDate &&
      dates.pickupDate <= holding.returnDate,
  );
  return held ? 'booked' : 'free';
}

function dateFieldErrors(error: 'pickupDate' | 'returnDate'): Record<string, string> {
  return { [error]: error === 'pickupDate' ? MESSAGES.pickupDate : MESSAGES.returnDate };
}

function parseOptionalDates(
  req: Request,
  today: string,
): { pickupDate: string; returnDate: string } | null {
  const pickup = req.query.pickupDate;
  const ret = req.query.returnDate;
  if (pickup === undefined && ret === undefined) {
    return null;
  }
  const parsed = validateDates(pickup, ret, today);
  if ('error' in parsed) {
    throw validation(dateFieldErrors(parsed.error));
  }
  return parsed;
}

function requireDates(req: Request, today: string): { pickupDate: string; returnDate: string } {
  const parsed = validateDates(req.query.pickupDate, req.query.returnDate, today);
  if ('error' in parsed) {
    throw validation(dateFieldErrors(parsed.error));
  }
  return parsed;
}

function headerOrNull(req: Request, name: string): string | null {
  const value = req.headers[name];
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  if (value.length > 100) {
    return null;
  }
  return value;
}

function parsedObject(req: Request): Record<string, unknown> {
  const body = (req as Request & { parsedBody?: unknown }).parsedBody;
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

// ---------- confirm and close flows (DP-15, DP-30) ----------

async function replayOrFresh(
  key: string | null,
  endpoint: string,
  path: string,
  rawBody: string,
): Promise<{ status: number; body: unknown } | null> {
  if (key === null) {
    return null;
  }
  return await withTransaction(async (client) => {
    const begun = await beginIdempotent(client, endpoint, path, key, rawBody);
    if (begun.kind === 'replay') {
      return { status: begun.response.status, body: JSON.parse(begun.response.body.toString('utf8')) };
    }
    return null;
  });
}

async function recordIdempotent(
  key: string | null,
  endpoint: string,
  path: string,
  rawBody: string,
  status: number,
  responseBody: string,
): Promise<void> {
  if (key === null) {
    return;
  }
  await withTransaction(async (client) => {
    await storeIdempotentResponse(client, endpoint, key, path, sha256(rawBody), status, responseBody);
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function confirmBooking(req: Request, context: ApiContext): Promise<{ status: number; body: unknown }> {
  const booking = await loadBooking(req.params.ref);
  if (booking === null) {
    throw new AppError(404, 'not_found', 'We could not find that booking');
  }
  const role = await staffOrRenterRole(req, booking);
  if (role === 'prep_tech') {
    throw forbidden();
  }
  const now = new Date();
  const fresh = await effectiveState(booking, now);
  if (fresh.state === 'expired') {
    throw new AppError(409, 'quote_expired', 'This hold has ended');
  }
  if (fresh.state !== 'quote') {
    throw stateConflict(fresh.ref, fresh.state);
  }
  const certificate = await loadLatestCertificate(fresh.ref);
  if (certificate === null || certificate.status !== 'approved') {
    throw new AppError(409, 'certificate_not_approved', 'Your certificate must be approved first');
  }
  // Claim the confirm: only one in flight at a time.
  // The claim flips the booking to pending and stamps the moment; a pending older
  // than a minute belongs to an attempt that died before reaching Kill Bill, and the
  // payment external key makes a second charge impossible.
  const claimed = await pool.query(
    `UPDATE bookings SET payment_status = 'pending', confirm_claimed_at = now()
       WHERE ref = $1 AND state = 'quote'
         AND (payment_status IN ('none','failed') OR confirm_claimed_at < now() - interval '1 minute')`,
    [fresh.ref],
  );
  if ((claimed.rowCount ?? 0) === 0) {
    const current = await loadBooking(fresh.ref);
    if (current !== null && current.state !== 'quote') {
      throw stateConflict(current.ref, current.state);
    }
    // A confirm is already in flight on this quote (DP-17).
    throw stateConflict(fresh.ref, 'quote');
  }
  // Reprice under the active rate card first (DP-21).
  const today = todayUtc(new Date());
  const rate = await activeRateFor(fresh.kitId, today);
  if (rate === null) {
    await pool.query("UPDATE bookings SET payment_status = 'none' WHERE ref = $1", [fresh.ref]);
    throw new AppError(404, 'not_found', 'We could not find that kit');
  }
  if (rate.version !== fresh.rateCardVersion) {
    const priced = priceHire(fresh.pickupDate, fresh.returnDate, {
      dayRateCents: rate.dayRateCents,
      depositCents: rate.depositCents,
    });
    await pool.query(
      `UPDATE bookings SET billable_days = $2, day_rate_cents = $3, hire_price_cents = $4,
          deposit_cents = $5, total_cents = $6, rate_card_version = $7
        WHERE ref = $1`,
      [
        fresh.ref,
        priced.billableDays,
        priced.dayRateCents,
        priced.hirePriceCents,
        priced.depositCents,
        priced.totalCents,
        rate.version,
      ],
    );
    const repriced = await loadBooking(fresh.ref);
    if (repriced === null) {
      throw new Error('booking vanished');
    }
    await pool.query("UPDATE bookings SET payment_status = 'none' WHERE ref = $1", [fresh.ref]);
    const view = bookingView(repriced, await buildBookingViewContext(repriced, new Date()));
    throw new AppError(409, 'quote_repriced', 'Prices changed', undefined, { booking: view });
  }
  // Confirm the certificate is present in storage before any charge.
  const present = await context.storage.get(certificate.storageKey);
  if (!present.ok) {
    await pool.query("UPDATE bookings SET payment_status = $2 WHERE ref = $1", [fresh.ref, fresh.paymentStatus]);
    if (present.reason === 'unreachable') {
      context.health.markStorageDown();
      throw storageUnavailable();
    }
    throw new AppError(409, 'certificate_not_stored', 'Your certificate could not be found. Upload it again.');
  }
  // Take the payment.
  const account = await ensureKillBillAccount(context, fresh);
  if (account === null) {
    await pool.query("UPDATE bookings SET payment_status = $2 WHERE ref = $1", [fresh.ref, fresh.paymentStatus]);
    context.health.markPaymentsDown();
    throw paymentsUnavailable();
  }
  const purchased = await context.killbill.purchase(
    account.accountId,
    account.paymentMethodId,
    fresh.ref,
    centsToDollars(fresh.totalCents),
  );
  if (!purchased.ok) {
    await pool.query("UPDATE bookings SET payment_status = $2 WHERE ref = $1", [fresh.ref, fresh.paymentStatus]);
    context.health.markPaymentsDown();
    throw paymentsUnavailable();
  }
  if (!purchaseSucceeded(purchased.value)) {
    await pool.query("UPDATE bookings SET payment_status = 'failed' WHERE ref = $1", [fresh.ref]);
    throw new AppError(402, 'payment_declined', 'Payment was declined');
  }
  // Send the confirmation mail.
  const view = await confirmedView(fresh.ref);
  const catalogue = await loadCatalogue();
  const classNames = new Map(catalogue.classes.map((klass) => [klass.id, klass.name]));
  const kitName = catalogue.kits.find((kit) => kit.id === fresh.kitId)?.name ?? fresh.kitId;
  const lines: string[] = [];
  for (const unit of view.units) {
    lines.push(`${unit.serial} · ${unit.className || classNames.get(unit.classId) || unit.classId}`);
  }
  lines.push(`Pickup ${view.pickupDate} · Return ${view.returnDate}`);
  lines.push(`Billable days: ${view.billableDays}`);
  lines.push(`Day rate: ${formatCents(view.dayRateCents)}`);
  lines.push(`Hire: ${formatCents(view.hirePriceCents)}`);
  lines.push(`Deposit: ${formatCents(view.depositCents)}`);
  lines.push(`Charged: ${formatCents(view.totalCents)}`);
  lines.push(`Rate card: v${view.rateCardVersion}`);
  const mailed = await context.mailer.send(
    view.renter.email,
    `Booking confirmed · ${view.ref} · ${kitName}`,
    lines.join('\n'),
  );
  if (!mailed.ok) {
    const refunded = await context.killbill.findPayment(fresh.ref);
    if (refunded.ok && refunded.value !== null) {
      await context.killbill.refund(refunded.value.paymentId, fresh.ref, centsToDollars(fresh.totalCents), 'cancel');
    }
    await pool.query("UPDATE bookings SET payment_status = 'none' WHERE ref = $1", [fresh.ref]);
    throw mailUnavailable();
  }
  await pool.query(
    `UPDATE bookings SET state = 'confirmed', confirmed_at = now(), payment_status = 'paid',
        confirmation_mail_at = now()
      WHERE ref = $1`,
    [fresh.ref],
  );
  return { status: 200, body: await confirmedView(fresh.ref) };
}

async function confirmedView(ref: string): Promise<ReturnType<typeof bookingView>> {
  const booking = await loadBooking(ref);
  if (booking === null) {
    throw new Error('booking vanished');
  }
  const effective = await effectiveState(booking, new Date());
  return bookingView(effective, await buildBookingViewContext(effective, new Date()));
}

interface KillBillAccount {
  accountId: string;
  paymentMethodId: string;
}

async function ensureKillBillAccount(context: ApiContext, booking: Booking): Promise<KillBillAccount | null> {
  const email = booking.renterEmail.toLowerCase();
  const found = await context.killbill.findAccountByEmail(email);
  if (!found.ok) {
    return null;
  }
  let accountId = found.value;
  if (accountId === null) {
    const created = await context.killbill.createAccount(booking.renterName, booking.renterEmail);
    if (!created.ok) {
      return null;
    }
    accountId = created.value;
  }
  const method = await context.killbill.ensurePaymentMethod(accountId, booking.renterEmail);
  if (!method.ok) {
    return null;
  }
  if (method.value === null) {
    return null;
  }
  return { accountId, paymentMethodId: method.value };
}

async function closeBooking(req: Request, context: ApiContext): Promise<{ status: number; body: unknown }> {
  const booking = await loadBooking(req.params.ref);
  if (booking === null) {
    throw new AppError(404, 'not_found', 'We could not find that booking');
  }
  const role = await staffOrRenterRole(req, booking);
  const fresh = await effectiveState(booking, new Date());
  if (!transitionAllowed('close', fresh.state, role)) {
    throw stateConflict(fresh.ref, fresh.state);
  }
  const photos = await loadBookingPhotos(fresh.ref);
  const storedCheckinPhotos = new Set(
    photos.filter((photo) => photo.phase === 'checkin' && photo.status === 'stored').map((photo) => photo.serial),
  );
  const blockers = closeBlockers(fresh, storedCheckinPhotos);
  if (blockers.length > 0) {
    throw new AppError(409, 'close_blocked', 'Close is blocked', undefined, { blockers });
  }
  const damage = await damageTotal(fresh.ref);
  const refund = Math.max(0, fresh.depositCents - damage);
  const account = await ensureKillBillAccount(context, fresh);
  if (account === null) {
    context.health.markPaymentsDown();
    throw paymentsUnavailable();
  }
  if (damage > 0) {
    const invoice = await context.killbill.recordDamageInvoice(account.accountId, fresh.ref, centsToDollars(damage));
    if (!invoice.ok) {
      context.health.markPaymentsDown();
      throw paymentsUnavailable();
    }
  }
  if (refund > 0) {
    const payment = await context.killbill.findPayment(fresh.ref);
    if (!payment.ok) {
      context.health.markPaymentsDown();
      throw paymentsUnavailable();
    }
    if (payment.value === null) {
      throw stateConflict(fresh.ref, fresh.state);
    }
    const refunded = await context.killbill.refund(payment.value.paymentId, fresh.ref, centsToDollars(refund), 'refund');
    if (!refunded.ok) {
      context.health.markPaymentsDown();
      throw paymentsUnavailable();
    }
  }
  await pool.query(
    `UPDATE bookings SET state = 'closed', closed_at = now(), damage_cents = $2, refund_cents = $3,
        payment_status = CASE WHEN $3::bigint > 0 THEN 'refunded' ELSE payment_status END
      WHERE ref = $1`,
    [fresh.ref, damage, refund],
  );
  // The receipt mail: sent at most once per booking.
  const alreadyMailed = await pool.query<{ receipt_mail_at: Date | null }>(
    'SELECT receipt_mail_at FROM bookings WHERE ref = $1',
    [fresh.ref],
  );
  if (alreadyMailed.rows[0].receipt_mail_at === null) {
    const view = await confirmedView(fresh.ref);
    const lines: string[] = [];
    for (const unit of view.units) {
      if (unit.condition === 'damaged') {
        lines.push(`${unit.serial} · Damaged · ${formatCents(unit.damageChargeCents)}`);
      } else {
        lines.push(`${unit.serial} · OK`);
      }
    }
    lines.push(`Damage charge: ${formatCents(damage)}`);
    lines.push(`Deposit refunded: ${formatCents(refund)}`);
    const mailed = await context.mailer.send(
      view.renter.email,
      `Return receipt · ${view.ref}`,
      lines.join('\n'),
    );
    if (mailed.ok) {
      await pool.query('UPDATE bookings SET receipt_mail_at = now() WHERE ref = $1', [fresh.ref]);
    }
  }
  return { status: 200, body: await confirmedView(fresh.ref) };
}

async function requireOwner(req: Request): Promise<'owner'> {
  const role = await sessionRole(req);
  if (role === null) {
    throw unauthenticated();
  }
  if (role !== 'owner') {
    throw forbidden();
  }
  return role;
}

async function replacementValueOf(booking: Booking): Promise<number> {
  const catalogue = await loadCatalogue();
  const values = new Map(catalogue.classes.map((klass) => [klass.id, klass.replacementValueCents]));
  return booking.units.reduce((sum, unit) => sum + (values.get(unit.classId) ?? 0), 0);
}

async function latestMovement(serial: string, reason: 'to_repair' | 'from_repair') {
  const result = await pool.query(
    'SELECT id, serial, reason, from_location, to_location, booking_ref, at FROM movements WHERE serial = $1 AND reason = $2 ORDER BY id DESC LIMIT 1',
    [serial, reason],
  );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0] as {
    id: string;
    reason: string;
    from_location: string;
    to_location: string;
    booking_ref: string | null;
    at: Date;
  };
  return {
    id: Number(row.id),
    at: row.at.toISOString(),
    reason: row.reason,
    from: row.from_location,
    to: row.to_location,
    bookingRef: row.booking_ref,
    entries: [
      { location: row.from_location, delta: -1 },
      { location: row.to_location, delta: 1 },
    ],
  };
}

type MovementView = {
  id: number;
  at: string;
  reason: string;
  from: string;
  to: string;
  bookingRef: string | null;
  entries: { location: string; delta: number }[];
};

function movementEntryView(movement: Movement): MovementView {
  return {
    id: movement.id,
    at: movement.at.toISOString(),
    reason: movement.reason,
    from: movement.fromLocation,
    to: movement.toLocation,
    bookingRef: movement.bookingRef,
    entries: [
      { location: movement.fromLocation, delta: -1 },
      { location: movement.toLocation, delta: 1 },
    ],
  };
}

async function activeRateVersion(): Promise<number | null> {
  const result = await pool.query<{ version: number }>(
    `SELECT version FROM rate_cards WHERE effective_date <= $1
      ORDER BY effective_date DESC, version DESC LIMIT 1`,
    [todayUtc(new Date())],
  );
  return result.rowCount === 0 ? null : result.rows[0].version;
}

async function currentAvailability(client: { query: PoolClient['query'] }) {
  const locations = await client.query<{ serial: string; location: string }>(
    `SELECT m.serial, e.location
       FROM movement_entries e JOIN movements m ON m.id = e.movement_id
      WHERE e.location <> 'acquired'
      GROUP BY m.serial, e.location HAVING SUM(e.delta) = 1`,
  );
  const holdings = await client.query<{ ref: string; pickupDate: string; returnDate: string; serial: string }>(
    `SELECT b.ref, b.pickup_date AS "pickupDate", b.return_date AS "returnDate", u.serial
       FROM bookings b JOIN booking_units u ON u.ref = b.ref
      WHERE b.state IN ('quote','confirmed','prepped','out','returned')
        AND (b.state <> 'quote' OR b.hold_expires_at > now())`,
  );
  return {
    unitLocations: new Map(locations.rows.map((row) => [row.serial, row.location])),
    holdings: holdings.rows.map((row) => ({
      ref: row.ref,
      pickupDate: new Date(row.pickupDate).toISOString().slice(0, 10),
      returnDate: new Date(row.returnDate).toISOString().slice(0, 10),
      serial: row.serial,
    })),
  };
}

async function loadBookingRow(client: PoolClient, ref: string): Promise<Booking> {
  const rows = await client.query(
    `SELECT ref, state, kit_id AS "kitId", pickup_date AS "pickupDate", return_date AS "returnDate",
            hire_days AS "hireDays", billable_days AS "billableDays", day_rate_cents AS "dayRateCents",
            hire_price_cents AS "hirePriceCents", deposit_cents AS "depositCents", total_cents AS "totalCents",
            rate_card_version AS "rateCardVersion", renter_name AS "renterName", renter_email AS "renterEmail",
            renter_key AS "renterKey", hold_expires_at AS "holdExpiresAt", payment_status AS "paymentStatus",
            damage_cents AS "damageCents", refund_cents AS "refundCents", created_at AS "createdAt",
            confirmed_at AS "confirmedAt", cancelled_at AS "cancelledAt", closed_at AS "closedAt",
            confirmation_mail_at AS "confirmationMailAt", receipt_mail_at AS "receiptMailAt"
       FROM bookings WHERE ref = $1`,
    [ref],
  );
  const units = await client.query(
    `SELECT serial, class_id AS "classId", checked_out_at AS "checkedOutAt", checked_in_at AS "checkedInAt",
            condition, damage_charge_cents AS "damageChargeCents", checkout_notes AS "checkoutNotes",
            checkin_notes AS "checkinNotes"
       FROM booking_units WHERE ref = $1 ORDER BY serial`,
    [ref],
  );
  const row = rows.rows[0];
  return {
    ref: row.ref,
    state: row.state,
    kitId: row.kitId,
    pickupDate: toDateString(row.pickupDate),
    returnDate: toDateString(row.returnDate),
    hireDays: row.hireDays,
    billableDays: row.billableDays,
    dayRateCents: Number(row.dayRateCents),
    hirePriceCents: Number(row.hirePriceCents),
    depositCents: Number(row.depositCents),
    totalCents: Number(row.totalCents),
    rateCardVersion: row.rateCardVersion,
    renterName: row.renterName,
    renterEmail: row.renterEmail,
    renterKey: row.renterKey,
    holdExpiresAt: row.holdExpiresAt,
    paymentStatus: row.paymentStatus,
    damageCents: Number(row.damageCents),
    refundCents: Number(row.refundCents),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt,
    closedAt: row.closedAt,
    confirmationMailAt: row.confirmationMailAt,
    receiptMailAt: row.receiptMailAt,
    units: units.rows.map((unit: Record<string, unknown>) => ({
      serial: unit.serial as string,
      classId: unit.classId as string,
      checkedOutAt: unit.checkedOutAt as Date | null,
      checkedInAt: unit.checkedInAt as Date | null,
      condition: unit.condition as 'ok' | 'damaged' | null,
      damageChargeCents: Number(unit.damageChargeCents),
      checkoutNotes: unit.checkoutNotes as string,
      checkinNotes: unit.checkinNotes as string,
    })),
  };
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return new Date(value as string).toISOString().slice(0, 10);
}

async function bookingViewAsync(booking: Booking) {
  return bookingView(booking, await buildBookingViewContext(booking, new Date()));
}
