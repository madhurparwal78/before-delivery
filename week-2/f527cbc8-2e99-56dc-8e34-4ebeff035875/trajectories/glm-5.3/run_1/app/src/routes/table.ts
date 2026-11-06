import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Caller, Role } from '../context.js';
import { AppError, Handled, ValidationError, IllegalTransition } from '../errors.js';
import { send, send204, requireJson } from '../respond.js';
import { requireRole, requireSession, isFarrierRole, isStaffRole } from '../roles.js';
import { consume } from '../rate.js';
import { connectDb, withTx, type Tx, type Row } from '../db.js';
import { config } from '../config.js';
import {
  now, todayInPractice, practiceZoneName, resolveWallClock, printInstant, printCutoff, printTimeSec,
  validDate, validTime, businessDate, addDays
} from '../time.js';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { audit, sessionActor, tokenActor, systemActor } from '../audit.js';
import { queueEmail, trySend, attemptRequestClaimed } from '../mail.js';
import { emails as T, money } from '../email-templates.js';
import { newId, lockDay, loadDay, bookedCount, sweepDay, offerPass, emitDayEvent, emitHorseEvent, cardOutcome, ownerBlocked, createHoldBooking } from '../domain.js';
import { splitFee, startDay, excuseBooking } from '../allocation.js';
import { priceListFor, buildInvoiceItems, enterDunning, recordInvoicePayment, dunningNextTry } from '../billing.js';
import { claimIdempotency, completeIdempotency, releaseIdempotency } from '../idem.js';
import { enqueueJob } from '../jobs.js';
import { signPhotoPath } from '../photourls.js';
import { putObject, getObject, deleteObject, deletePrefix, StorageUnavailable } from '../storage.js';
import sharp from 'sharp';
import { nextDueState } from '../nextdue.js';
import { ledgerEntry } from '../ledger.js';
import { parseCsv, validateImport } from '../csvimport.js';
import * as kb from '../killbill.js';
import { parseSessionCookie, sessionCookieHeader } from '../request.js';
import { CARD_LABELS } from '../cards.js';
import { SERVICE_CODES } from '../services.js';
import { tokenHash, newTokenPlaintext } from '../apitokens.js';
import { readBody } from './body.js';
import { serveSse } from './sse.js';

const JSON_LIMIT = 65536;
const MULTIPART_LIMIT = 8500000;
const IMPORT_LIMIT = 1000000;

export async function route(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestId: string,
  address: string,
  caller: Caller | null
): Promise<number> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  const seg = path.slice('/api/'.length).split('/').filter(Boolean);

  const ctx = { req, res, url, requestId, address, caller, method };

  // --- Session -----------------------------------------------------------
  if (seg[0] === 'session' && seg.length === 1) {
    if (method === 'POST') return signIn(ctx);
    if (method === 'DELETE') return signOut(ctx);
    throw new AppError(405, 'method_not_allowed');
  }
  if (seg[0] === 'my') {
    if (!caller) throw new AppError(401, 'unauthenticated');
    if (method === 'GET' && seg.length === 1) {
      send(res, requestId, 200, { id: caller.id, name: caller.name, email: caller.email, role: caller.role === 'farrier_token' ? 'farrier' : caller.role });
      return 200;
    }
    if (method === 'PUT' && seg[1] === 'card') return putCard(ctx);
    if (method === 'GET' && seg[1] === 'bookings') return myBookings(ctx);
    throw new AppError(405, 'method_not_allowed');
  }

  if (seg[0] === 'practice' && method === 'GET') {
    requireRole(caller, ['farrier', 'apprentice', 'owner', 'barn_manager']);
    send(res, requestId, 200, { name: 'Rasp & Rein', time_zone: practiceZoneName(), today: todayInPractice() });
    return 200;
  }
  if (seg[0] === 'barns' && method === 'GET') {
    requireRole(caller, ['farrier', 'apprentice', 'token']);
    const rows = await withTx(tx => tx.query(`select id, name, trip_fee_cents from barns order by name`));
    send(res, requestId, 200, rows.map((b: Row) => ({ id: b.id, name: b.name, trip_fee_cents: b.trip_fee_cents })));
    return 200;
  }

  if (seg[0] === 'price-lists') return priceLists(ctx);
  if (seg[0] === 'horses') return horses(ctx);
  if (seg[0] === 'imports' && method === 'POST') return importCsv(ctx);
  if (seg[0] === 'barn-days') return barnDays(ctx);
  if (seg[0] === 'bookings') return bookings(ctx);
  if (seg[0] === 'visits') return visits(ctx);
  if (seg[0] === 'uploads') return uploads(ctx);
  if (seg[0] === 'photos') return photos(ctx);
  if (seg[0] === 'payments') return payments(ctx);
  if (seg[0] === 'invoices') return invoices(ctx);
  if (seg[0] === 'dashboard') return dashboard(ctx);
  if (seg[0] === 'jobs') return jobsRoutes(ctx);
  if (seg[0] === 'tokens') return tokensRoutes(ctx);
  if (seg[0] === 'audit' && method === 'GET') return auditRoute(ctx);
  if (seg[0] === 'vet-links') return vetLinksAdmin(ctx);

  throw new AppError(404, 'not_found');
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  requestId: string;
  address: string;
  caller: Caller | null;
  method: string;
}

// --- helpers -------------------------------------------------------------

async function jsonBody(ctx: Ctx, limit = JSON_LIMIT): Promise<{ parsed: Record<string, unknown>; raw: Buffer }> {
  const ct = String(ctx.req.headers['content-type'] ?? '');
  if (!ct.startsWith('application/json')) throw new AppError(415, 'unsupported_media_type');
  const raw = await readBody(ctx.req, limit);
  if (raw.length === 0) return { parsed: {}, raw };
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return { parsed: parsed as Record<string, unknown>, raw };
  } catch {
    throw new AppError(400, 'bad_request');
  }
}

async function takeAllowance(ctx: Ctx, bucket: string, userKey: string | null): Promise<Record<string, string>> {
  const entries: Array<{ scope: 'user' | 'address'; key: string }> = [{ scope: 'address', key: ctx.address }];
  if (userKey) entries.push({ scope: 'user', key: userKey });
  const r = await consume(null, bucket, entries);
  if (!r.ok) {
    throw new AppError(429, 'rate_limited', { bucket, scope: r.refusing!.scope, ...Object.fromEntries(Object.entries({ 'Retry-After': String(r.retryAfter) })) });
  }
  return r.headers;
}

function rateErrorHeaders(err: AppError): Record<string, string> {
  return err instanceof AppError && err.code === 'rate_limited'
    ? { 'Retry-After': String(err.extra['Retry-After'] ?? 1) }
    : {};
}

export { rateErrorHeaders };

async function requireFarrierSession(ctx: Ctx): Promise<Caller> {
  const c = requireSession(ctx.caller);
  if (c.role !== 'farrier') throw new AppError(403, 'forbidden');
  return c;
}

function actorOf(ctx: Ctx): { audit: import('../audit.js').AuditActor; requestId: string } {
  const c = ctx.caller!;
  return { audit: c.type === 'token' ? tokenActor(c.id) : sessionActor(c.id), requestId: ctx.requestId };
}

/** Queues a request-claimed email and makes the first attempt after commit. */
async function sendRequestEmail(msg: { to: string; subject: string; body: string }): Promise<void> {
  const id = await withTx(tx => queueEmail(tx, msg, true));
  attemptRequestClaimed(id).catch(() => {});
}

// --- Session -------------------------------------------------------------

async function signIn(ctx: Ctx): Promise<number> {
  const ct = String(ctx.req.headers['content-type'] ?? '');
  if (!ct.startsWith('application/json')) throw new AppError(415, 'unsupported_media_type');
  const raw = await readBody(ctx.req, JSON_LIMIT);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new AppError(400, 'bad_request'); }
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  await takeAllowance(ctx, 'SIGN_IN', email.toLowerCase());
  const rows = await withTx(tx => tx.query(`select * from users where lower(email) = lower($1)`, [email]));
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'invalid_credentials');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await withTx(async tx => {
    await tx.query(`insert into sessions(id, user_id, created_at, last_seen) values($1,$2,$3,$3)`, [token, user.id, now()]);
  });
  ctx.res.setHeader('Set-Cookie', sessionCookieHeader(token));
  send(ctx.res, ctx.requestId, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  return 200;
}

async function signOut(ctx: Ctx): Promise<number> {
  const token = parseSessionCookie(ctx.req);
  if (token) {
    await withTx(tx => tx.query(`delete from sessions where id = $1`, [token]));
  }
  send204(ctx.res, ctx.requestId);
  return 204;
}

async function putCard(ctx: Ctx): Promise<number> {
  const c = requireSession(ctx.caller);
  if (c.role !== 'owner') throw new AppError(403, 'forbidden');
  await takeAllowance(ctx, 'PAYMENT', c.id);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const token = typeof body.card_token === 'string' ? body.card_token : '';
  const errors: Record<string, string> = {};
  if (/\d{12,}/.test(token)) errors.card_token = 'Enter a test card token, never a card number.';
  else if (!CARD_LABELS[token]) errors.card_token = 'Choose one of the test cards.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  const outcome = cardOutcome(token);
  await withTx(tx => tx.query(`update users set card_token = $2, card_last4 = $3 where id = $1`, [c.id, token, outcome.last4]));
  send(ctx.res, ctx.requestId, 200, { last4: outcome.last4 });
  return 200;
}

async function myBookings(ctx: Ctx): Promise<number> {
  const c = requireSession(ctx.caller);
  if (c.role !== 'owner') throw new AppError(403, 'forbidden');
  const t = now();
  const rows = await withTx(async tx => {
    await sweepDayByOwner(tx, c.id, ctx);
    const bs = await tx.query(
      `select b.*, h.name as horse_name, s.time as slot_time from bookings b
       join horses h on h.id = b.horse_id join slots s on s.id = b.slot_id
       where b.owner_id = $1 and b.status in ('held','confirmed','cancelled_in_time','cancelled_late','worked','no_show','excused')
       order by b.created_at desc`,
      [c.id]
    );
    return bs;
  });
  send(ctx.res, ctx.requestId, 200, rows.map((b: Row) => bookingJson(b, b.horse_name, true)));
  return 200;
}

async function sweepDayByOwner(tx: Tx, ownerId: string, ctx: Ctx): Promise<void> {
  const days = await tx.query(
    `select distinct b.barn_day_id from bookings b where b.owner_id = $1 and b.status = 'held'`,
    [ownerId]
  );
  for (const d of days) {
    await sweepDay(tx, d.barn_day_id, null);
    await offerPass(tx, d.barn_day_id, null);
  }
}

// --- Booking JSON (single projection, DP-48) ------------------------------

function bookingJson(b: Row, horseName: string, mine: boolean): Record<string, unknown> {
  return {
    id: b.id,
    number: b.number,
    status: b.status,
    barn_day_id: b.barn_day_id,
    slot_id: b.slot_id,
    slot_time: b.slot_time,
    horse: { id: b.horse_id, name: horseName },
    hold_expires_at: b.status === 'held' && b.hold_expires_at ? printInstant(b.hold_expires_at) : null,
    trip_share_cents: b.trip_share_cents,
    offer: b.offer,
    deposit_cents: b.deposit_cents,
    payment_id: b.payment_id
  };
}

// --- Horses ----------------------------------------------------------------

async function horseJson(tx: Tx, h: Row, forFarrier: boolean): Promise<Record<string, unknown>> {
  const visits = await tx.query(
    `select business_date, status from visits where horse_id = $1 order by business_date desc, created_at desc`,
    [h.id]
  );
  const lastWorked = visits.find((v: Row) => v.status !== 'open')?.business_date ?? null;
  const due = nextDueState(lastWorked, h.cycle_weeks);
  const barn = (await tx.query(`select id, name from barns where id = $1`, [h.barn_id]))[0];
  const out: Record<string, unknown> = {
    id: h.id,
    name: h.name,
    barn: { id: barn.id, name: barn.name },
    stall: h.stall,
    cycle_weeks: h.cycle_weeks,
    last_worked_date: lastWorked,
    next_due_date: due.next_due_date,
    due_status: due.due_status
  };
  if (forFarrier) {
    const owner = (await tx.query(`select id, name, email, phone from users where id = $1`, [h.owner_id]))[0];
    out.owner = { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone };
  }
  return out;
}

async function horses(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const method = ctx.method;
  const seg = ctx.url.pathname.slice('/api/horses'.length).split('/').filter(Boolean);

  if (seg[0] && seg[1] === 'events') {
    // horse event stream: staff or the horse's owner
    const rows = await withTx(async tx => {
      await lockHorse(tx, ctx, seg[0]);
      return tx.query(`select * from horses where id = $1`, [seg[0]]);
    });
    if (rows.length === 0) throw new AppError(404, 'not_found');
    const stream = c.type === 'session' && c.role === 'owner' ? `horse:${seg[0]}:owner` : `horse:${seg[0]}:staff`;
    await serveSse(ctx.req, ctx.res, ctx.url, ctx.requestId, stream);
    return 200;
  }
  if (seg[0] && seg[1] === 'comparison' && method === 'GET') return comparison(ctx, seg[0]);
  if (seg[0] && seg[1] === 'vet-links') return vetLinksForHorse(ctx, seg[0]);
  if (seg[0] && seg[1] === 'visits' && method === 'GET') return horseVisits(ctx, seg[0]);

  if (method === 'GET' && seg.length === 0) {
    requireRole(c, ['farrier', 'apprentice', 'owner']);
    const list = await withTx(async tx => {
      let rows: Row[];
      if (c.type === 'session' && c.role === 'owner') {
        rows = await tx.query(`select * from horses where owner_id = $1 order by name`, [c.id]);
      } else {
        rows = await tx.query(`select * from horses order by name`);
      }
      const forFarrier = c.type === 'token' || c.role === 'farrier';
      const out = [];
      for (const h of rows) out.push(await horseJson(tx, h, forFarrier));
      return out;
    });
    send(ctx.res, ctx.requestId, 200, list);
    return 200;
  }
  if (method === 'GET' && seg.length === 1) {
    requireRole(c, ['farrier', 'apprentice', 'owner']);
    const row = await withTx(async tx => {
      await lockHorse(tx, ctx, seg[0]);
      const rows = await tx.query(`select * from horses where id = $1`, [seg[0]]);
      if (rows.length === 0) return null;
      const h = rows[0];
      if (c.type === 'session' && c.role === 'owner' && h.owner_id !== c.id) return null;
      return horseJson(tx, h, c.type === 'token' || c.role === 'farrier');
    });
    if (!row) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, row);
    return 200;
  }
  throw new AppError(404, 'not_found');
}

async function lockHorse(tx: Tx, ctx: Ctx, horseId: string): Promise<void> {
  const rows = await tx.query(`select owner_id from horses where id = $1`, [horseId]);
  if (rows.length === 0) return;
  if (ctx.caller && ctx.caller.type === 'session' && ctx.caller.role === 'owner' && rows[0].owner_id !== ctx.caller.id) return;
  // Serialise visits on the horse's day so visit lists stay consistent.
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`horse:${horseId}`]);
}

async function horseVisits(ctx: Ctx, horseId: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'owner']);
  const visits = await withTx(async tx => {
    const horses = await tx.query(`select * from horses where id = $1`, [horseId]);
    if (horses.length === 0) return null;
    if (c.type === 'session' && c.role === 'owner' && horses[0].owner_id !== c.id) return null;
    const rows = await tx.query(
      `select * from visits where horse_id = $1 order by business_date desc, created_at desc`,
      [horseId]
    );
    const out = [];
    for (const v of rows) {
      if (c.type === 'session' && c.role === 'owner' && v.status === 'open') continue;
      out.push(await visitJson(tx, v, c));
    }
    return out;
  });
  if (visits === null) throw new AppError(404, 'not_found');
  send(ctx.res, ctx.requestId, 200, visits);
  return 200;
}

async function visitJson(tx: Tx, v: Row, caller: Caller | null): Promise<Record<string, unknown>> {
  const horse = (await tx.query(`select id, name from horses where id = $1`, [v.horse_id]))[0];
  const photos = await tx.query(`select * from photos where visit_id = $1 order by created_at`, [v.id]);
  const marks = await tx.query(
    `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by where m.visit_id = $1`,
    [v.id]
  );
  const latest = new Map<string, Row>();
  for (const m of marks) {
    const prev = latest.get(m.hoof);
    if (!prev || m.version > prev.version) latest.set(m.hoof, m);
  }
  const marksOut = [];
  for (const [hoof, m] of latest) marksOut.push(marksJson(m, true));
  let invoice: Record<string, unknown> | null = null;
  if (v.invoice_id && caller && (caller.type === 'token' || (caller.type === 'session' && caller.role === 'farrier'))) {
    const inv = (await tx.query(`select * from invoices where id = $1`, [v.invoice_id]))[0];
    if (inv) invoice = invoiceJson(inv);
  } else if (v.invoice_id && caller && caller.type === 'session' && caller.role === 'owner') {
    const inv = (await tx.query(
      `select i.*, h.name as horse_name from invoices i join horses h on h.id = i.horse_id where i.id = $1`, [v.invoice_id]))[0];
    if (inv) invoice = invoiceJson(inv);
  }
  const photoOut = [];
  for (const p of photos) photoOut.push(await photoJson(tx, p));
  return {
    id: v.id,
    status: v.status,
    horse: { id: horse.id, name: horse.name },
    booking_id: v.booking_id,
    business_date: typeof v.business_date === 'string' ? v.business_date.slice(0, 10) : v.business_date,
    note: v.note,
    photos: photoOut,
    marks: marksOut,
    invoice
  };
}

async function photoJson(tx: Tx, p: Row): Promise<Record<string, unknown>> {
  const signed = await signPhotoPath(tx, p.id, false, false, null);
  const thumbSigned = p.thumbnail_status === 'ready' ? await signPhotoPath(tx, p.id, true, false, null) : null;
  return {
    id: p.id,
    visit_id: p.visit_id,
    hoof: p.hoof,
    phase: p.phase,
    content_type: p.content_type,
    width: p.width,
    height: p.height,
    url: signed.path,
    url_expires_at: printInstant(signed.expiresAt),
    thumbnail_status: p.thumbnail_status,
    thumbnail_url: thumbSigned ? thumbSigned.path : null
  };
}

function invoiceJson(inv: Row): Record<string, unknown> {
  return {
    id: inv.id,
    kind: inv.kind,
    status: inv.status,
    horse: { id: inv.horse_id, name: inv.horse_name ?? '' },
    business_date: typeof inv.business_date === 'string' ? inv.business_date.slice(0, 10) : inv.business_date,
    items: inv.items,
    total_cents: inv.total_cents,
    balance_cents: inv.balance_cents,
    killbill_invoice_id: inv.killbill_invoice_id,
    dunning_state: inv.dunning_state,
    reconciliation: inv.reconciliation
  };
}

function marksJson(m: Row & { saved_by_name?: string; saved_by_role?: string }, withAttribution: boolean): Record<string, unknown> {
  const base: Record<string, unknown> = {
    hoof: m.hoof,
    version: m.version,
    hoof_wall: { x1: m.hx1, y1: m.hy1, x2: m.hx2, y2: m.hy2, angle: m.hoof_wall_angle },
    pastern: { x1: m.px1, y1: m.py1, x2: m.px2, y2: m.py2, angle: m.pastern_angle },
    alignment: m.alignment
  };
  if (withAttribution) {
    base.saved_by = { id: m.saved_by, name: m.saved_by_name ?? '', role: m.saved_by_role ?? 'farrier' };
    base.saved_at = printInstant(m.saved_at);
    base.restored_from = m.restored_from;
  }
  return base;
}

// --- Barn days ---------------------------------------------------------------

function derivedDayStatus(stored: string, booked: number, slotCount: number): string {
  if (stored === 'published' && booked >= slotCount) return 'full';
  return stored;
}

async function dayJson(tx: Tx, day: Row, caller: Caller | null): Promise<Record<string, unknown>> {
  const { count, slotIds } = await bookedCount(tx, day.id);
  const slots = await tx.query(`select * from slots where barn_day_id = $1 order by idx`, [day.id]);
  const t = now();
  let myBooking: Row | null = null;
  if (caller && caller.type === 'session' && caller.role === 'owner') {
    const mine = await tx.query(
      `select * from bookings where barn_day_id = $1 and owner_id = $2 and status in ('held','confirmed') order by created_at desc limit 1`,
      [day.id, caller.id]
    );
    myBooking = mine.find((b: Row) => b.status !== 'held' || (b.hold_expires_at && b.hold_expires_at.getTime() > t.getTime())) ?? null;
  }
  const isManager = caller && caller.type === 'session' && caller.role === 'barn_manager';
  const out: Record<string, unknown> = {
    id: day.id,
    barn: { id: day.barn_id, name: (await tx.query(`select name from barns where id = $1`, [day.barn_id]))[0].name },
    business_date: typeof day.business_date === 'string' ? day.business_date.slice(0, 10) : day.business_date,
    start_time: day.start_time,
    time_zone: practiceZoneName(),
    starts_at: printInstant(day.starts_at),
    cancellation_cutoff_at: printInstant(day.cancellation_cutoff_at),
    slot_count: day.slot_count,
    slot_minutes: day.slot_minutes,
    booked_count: count,
    trip_fee_cents: day.trip_fee_cents,
    status: derivedDayStatus(day.status, count, day.slot_count),
    slots: slots.map((s: Row) => ({
      id: s.id,
      time: s.time,
      state: slotIds.has(s.id) ? 'taken' : 'open',
      my_booking_id: myBooking && myBooking.slot_id === s.id ? myBooking.id : null
    }))
  };
  if (isManager) {
    delete out.trip_fee_cents;
    delete out.my_booking_id;
    delete out.slots;
  }
  return out;
}

function visibleToOwner(day: Row, ownerHorseBarns: Set<string>): boolean {
  return ['published', 'in_progress'].includes(day.status) && ownerHorseBarns.has(day.barn_id);
}

async function ownerBarns(tx: Tx, ownerId: string): Promise<Set<string>> {
  const rows = await tx.query(`select distinct barn_id from horses where owner_id = $1`, [ownerId]);
  return new Set(rows.map((r: Row) => r.barn_id));
}

async function barnDays(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const method = ctx.method;
  const seg = ctx.url.pathname.slice('/api/barn-days'.length).split('/').filter(Boolean);

  if (seg.length === 0 && method === 'GET') {
    requireRole(c, ['farrier', 'apprentice', 'owner', 'barn_manager']);
    const days = await withTx(async tx => {
      let rows = await tx.query(`select * from barn_days order by business_date, id`);
      if (c.type === 'session' && c.role === 'owner') {
        const barns = await ownerBarns(tx, c.id);
        rows = rows.filter((d: Row) => visibleToOwner(d, barns));
      } else if (c.type === 'session' && c.role === 'barn_manager') {
        const me = (await tx.query(`select barn_id from users where id = $1`, [c.id]))[0];
        rows = rows.filter((d: Row) => d.barn_id === me.barn_id && d.status !== 'draft' && d.status !== 'cancelled');
      } else {
        rows = rows.filter((d: Row) => d.status !== 'cancelled');
      }
      const out = [];
      for (const d of rows) out.push(await dayJson(tx, d, c));
      return out;
    });
    send(ctx.res, ctx.requestId, 200, days);
    return 200;
  }
  if (seg.length === 0 && method === 'POST') return createDay(ctx);

  const dayId = seg[0];
  if (method === 'GET' && seg.length === 1) {
    requireRole(c, ['farrier', 'apprentice', 'owner', 'barn_manager']);
    const day = await withTx(async tx => {
      await sweepDay(tx, dayId, null);
      await offerPass(tx, dayId, null);
      const rows = await tx.query(`select * from barn_days where id = $1`, [dayId]);
      if (rows.length === 0) return null;
      const d = rows[0];
      if (c.type === 'session' && c.role === 'owner') {
        const barns = await ownerBarns(tx, c.id);
        if (!visibleToOwner(d, barns)) return null;
      } else if (c.type === 'session' && c.role === 'barn_manager') {
        const me = (await tx.query(`select barn_id from users where id = $1`, [c.id]))[0];
        if (d.barn_id !== me.barn_id || d.status === 'draft' || d.status === 'cancelled') return null;
      }
      return dayJson(tx, d, c);
    });
    if (!day) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, day);
    return 200;
  }
  if (method === 'PATCH' && seg.length === 1) return patchDay(ctx, dayId);
  if (seg[1] === 'bookings') {
    if (ctx.method === 'POST') return holdSlot(ctx, dayId);
    return dayBookings(ctx, dayId);
  }
  if (seg[1] === 'waitlist') return waitlist(ctx, dayId);
  if (seg[1] === 'allocation' && method === 'GET') return allocation(ctx, dayId);
  if (seg[1] === 'events' && method === 'GET') {
    requireRole(c, ['farrier', 'apprentice', 'barn_manager']);
    const visible = await withTx(async tx => {
      const rows = await tx.query(`select * from barn_days where id = $1`, [dayId]);
      if (rows.length === 0) return false;
      if (c.type === 'session' && c.role === 'barn_manager') {
        const me = (await tx.query(`select barn_id from users where id = $1`, [c.id]))[0];
        return rows[0].barn_id === me.barn_id;
      }
      return true;
    });
    if (!visible) throw new AppError(404, 'not_found');
    const role = c.type === 'session' ? c.role : 'farrier';
    await serveSse(ctx.req, ctx.res, ctx.url, ctx.requestId, `day:${dayId}:${role}`);
    return 200;
  }
  if (method === 'POST' && ['publish', 'start', 'close', 'cancel'].includes(seg[1] ?? '')) {
    return dayTransition(ctx, dayId, seg[1] as 'publish' | 'start' | 'close' | 'cancel');
  }
  throw new AppError(404, 'not_found');
}

async function createDay(ctx: Ctx): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const errors: Record<string, string> = {};
  const barnId = typeof body.barn_id === 'string' ? body.barn_id : '';
  const businessDateV = typeof body.business_date === 'string' ? body.business_date : '';
  const startTime = typeof body.start_time === 'string' ? body.start_time : '';
  const slotCount = typeof body.slot_count === 'number' ? body.slot_count : NaN;
  const slotMinutes = typeof body.slot_minutes === 'number' ? body.slot_minutes : NaN;
  let tripFee = typeof body.trip_fee_cents === 'number' ? body.trip_fee_cents : null;

  const barn = (await withTx(tx => tx.query(`select * from barns where id = $1`, [barnId])))[0];
  if (!barn) errors.barn_id = 'This is required.';
  if (!validDate(businessDateV)) errors.business_date = 'This is required.';
  else if (businessDateV < todayInPractice()) errors.business_date = 'Pick today or a later date.';
  if (!validTime(startTime)) errors.start_time = 'This is required.';
  if (!(Number.isInteger(slotCount) && slotCount >= 1 && slotCount <= 12)) errors.slot_count = 'Enter a number from 1 to 12.';
  if (!(Number.isInteger(slotMinutes) && slotMinutes >= 15 && slotMinutes <= 120)) errors.slot_minutes = 'Enter a number from 15 to 120.';
  if (tripFee !== null && !(Number.isInteger(tripFee) && tripFee >= 0 && tripFee <= 100000)) errors.trip_fee_cents = 'Enter an amount in dollars, like 45.00.';

  let startsAt: Date | null = null;
  if (!errors.start_time && !errors.business_date) {
    startsAt = resolveWallClock(businessDateV, startTime, practiceZoneName());
    if (!startsAt) errors.start_time = `That time does not exist on that date in ${practiceZoneName()}.`;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const day = await withTx(async tx => {
    const dayRow = {
      id: newId('day'),
      barn_id: barnId,
      business_date: businessDateV,
      start_time: startTime,
      starts_at: startsAt!,
      cancellation_cutoff_at: new Date(startsAt!.getTime() - 86400e3),
      slot_count: slotCount,
      slot_minutes: slotMinutes,
      trip_fee_cents: tripFee ?? barn.trip_fee_cents,
      status: 'draft',
      created_at: now()
    };
    const [h, m] = startTime.split(':').map(Number);
    await tx.query(
      `insert into barn_days(id, barn_id, business_date, start_time, starts_at, cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10)`,
      [dayRow.id, dayRow.barn_id, dayRow.business_date, dayRow.start_time, dayRow.starts_at, dayRow.cancellation_cutoff_at, dayRow.slot_count, dayRow.slot_minutes, dayRow.trip_fee_cents, dayRow.created_at]
    );
    for (let i = 0; i < slotCount; i++) {
      const t = h * 60 + m + i * slotMinutes;
      await tx.query(`insert into slots(id, barn_day_id, idx, time) values($1,$2,$3,$4)`,
        [newId('slt'), dayRow.id, i, `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`]);
    }
    await audit(tx, sessionActor(c.id), 'create', 'barn_day', dayRow.id, null, 'draft', ctx.requestId);
    return (await tx.query(`select * from barn_days where id = $1`, [dayRow.id]))[0];
  });
  send(ctx.res, ctx.requestId, 201, await withTx(tx => dayJson(tx, day, c)));
  return 201;
}

async function patchDay(ctx: Ctx, dayId: string): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const day = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return null;
    if (d.status !== 'draft') throw new IllegalTransition(d.status, 'edit');
    return d;
  });
  if (!day) throw new AppError(404, 'not_found');

  const errors: Record<string, string> = {};
  const businessDateV = typeof body.business_date === 'string' ? body.business_date : (day as any).business_date;
  const startTime = typeof body.start_time === 'string' ? body.start_time : (day as any).start_time;
  const slotCount = typeof body.slot_count === 'number' ? body.slot_count : (day as any).slot_count;
  const slotMinutes = typeof body.slot_minutes === 'number' ? body.slot_minutes : (day as any).slot_minutes;
  const tripFee = typeof body.trip_fee_cents === 'number' ? body.trip_fee_cents : (day as any).trip_fee_cents;

  if (!validDate(businessDateV)) errors.business_date = 'This is required.';
  else if (businessDateV < todayInPractice()) errors.business_date = 'Pick today or a later date.';
  if (!validTime(startTime)) errors.start_time = 'This is required.';
  if (!(Number.isInteger(slotCount) && slotCount >= 1 && slotCount <= 12)) errors.slot_count = 'Enter a number from 1 to 12.';
  if (!(Number.isInteger(slotMinutes) && slotMinutes >= 15 && slotMinutes <= 120)) errors.slot_minutes = 'Enter a number from 15 to 120.';
  if (!(Number.isInteger(tripFee) && tripFee >= 0 && tripFee <= 100000)) errors.trip_fee_cents = 'Enter an amount in dollars, like 45.00.';
  let startsAt: Date | null = null;
  if (!errors.start_time && !errors.business_date) {
    startsAt = resolveWallClock(businessDateV, startTime, practiceZoneName());
    if (!startsAt) errors.start_time = `That time does not exist on that date in ${practiceZoneName()}.`;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const updated = await withTx(async tx => {
    await lockDay(tx, dayId);
    await tx.query(
      `update barn_days set business_date=$2, start_time=$3, starts_at=$4, cancellation_cutoff_at=$5, slot_count=$6, slot_minutes=$7, trip_fee_cents=$8 where id=$1`,
      [dayId, businessDateV, startTime, startsAt!, new Date(startsAt!.getTime() - 86400e3), slotCount, slotMinutes, tripFee]
    );
    if (slotCount !== (day as any).slot_count || slotMinutes !== (day as any).slot_minutes) {
      await tx.query(`delete from slots where barn_day_id = $1`, [dayId]);
      const [h, m] = startTime.split(':').map(Number);
      for (let i = 0; i < slotCount; i++) {
        const t = h * 60 + m + i * slotMinutes;
        await tx.query(`insert into slots(id, barn_day_id, idx, time) values($1,$2,$3,$4)`,
          [newId('slt'), dayId, i, `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`]);
      }
    }
    return (await tx.query(`select * from barn_days where id = $1`, [dayId]))[0];
  });
  send(ctx.res, ctx.requestId, 200, await withTx(tx => dayJson(tx, updated, c)));
  return 200;
}

async function dayTransition(ctx: Ctx, dayId: string, action: 'publish' | 'start' | 'close' | 'cancel'): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const actor = { audit: sessionActor(c.id), requestId: ctx.requestId };
  const day = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return null;
    await sweepDay(tx, dayId, actor);
    const allowed: Record<string, string[]> = {
      publish: ['draft'],
      start: ['published'],
      close: ['in_progress'],
      cancel: ['draft', 'published']
    };
    if ((action === 'start' || action === 'publish') && d.status === 'published') {
      // full days start too
      if (action === 'start') { /* allowed below */ }
    }
    if (!allowed[action].includes(d.status)) {
      throw new IllegalTransition(derivedDayStatus(d.status, (await bookedCount(tx, dayId)).count, d.slot_count), action);
    }
    if (action === 'publish') {
      if (d.business_date < todayInPractice()) throw new AppError(409, 'date_passed');
      await tx.query(`update barn_days set status = 'published' where id = $1`, [dayId]);
      await audit(tx, sessionActor(c.id), 'publish', 'barn_day', dayId, 'draft', 'published', ctx.requestId);
      for (const role of ['farrier', 'apprentice', 'barn_manager'] as const) {
        await emitDayEvent(tx, dayId, role, 'day_status', { status: 'published' });
      }
      return (await tx.query(`select * from barn_days where id = $1`, [dayId]))[0];
    }
    if (action === 'start') {
      if (d.business_date > todayInPractice()) throw new AppError(409, 'too_early');
      return startDay(tx, d, actor);
    }
    if (action === 'cancel') {
      const t = now();
      const confirmed = await tx.query(
        `select * from bookings where barn_day_id = $1 and status = 'confirmed'`,
        [dayId]
      );
      for (const b of confirmed) {
        await cancelBookingRow(tx, b, t, c.id, ctx.requestId, true);
      }
      await tx.query(`update barn_days set status = 'cancelled' where id = $1`, [dayId]);
      await audit(tx, sessionActor(c.id), 'cancel', 'barn_day', dayId, d.status, 'cancelled', ctx.requestId);
      for (const role of ['farrier', 'apprentice', 'barn_manager'] as const) {
        await emitDayEvent(tx, dayId, role, 'day_status', { status: 'cancelled' });
      }
      return (await tx.query(`select * from barn_days where id = $1`, [dayId]))[0];
    }
    // close
    const openVisits = await tx.query(
      `select 1 from visits v join bookings b on b.id = v.booking_id where b.barn_day_id = $1 and v.status = 'open' limit 1`,
      [dayId]
    );
    const confirmed = await tx.query(
      `select 1 from bookings where barn_day_id = $1 and status = 'confirmed' limit 1`,
      [dayId]
    );
    if (openVisits.length > 0 || confirmed.length > 0) throw new AppError(409, 'unresolved_bookings');
    await tx.query(`update barn_days set status = 'closed' where id = $1`, [dayId]);
    await audit(tx, sessionActor(c.id), 'close', 'barn_day', dayId, 'in_progress', 'closed', ctx.requestId);
    for (const role of ['farrier', 'apprentice', 'barn_manager'] as const) {
      await emitDayEvent(tx, dayId, role, 'day_status', { status: 'closed' });
    }
    // Trip-only invoices for late-cancelled and no-show bookings.
    const lateOrNoShow = await tx.query(
      `select b.*, h.name as horse_name, u.email as owner_email, u.name as owner_name, br.name as barn_name
       from bookings b join horses h on h.id = b.horse_id join users u on u.id = b.owner_id join barn_days d on d.id = b.barn_day_id join barns br on br.id = d.barn_id
       where b.barn_day_id = $1 and b.status in ('cancelled_late','no_show') and coalesce(b.trip_share_cents, 0) > 0`,
      [dayId]
    );
    for (const b of lateOrNoShow) {
      await createTripOnlyInvoice(tx, b, ctx.requestId);
    }
    return (await tx.query(`select * from barn_days where id = $1`, [dayId]))[0];
  });
  if (!day) throw new AppError(404, 'not_found');
  send(ctx.res, ctx.requestId, 200, await withTx(tx => dayJson(tx, day, c)));
  return 200;
}

// --- Booking rows per role (DP-11) --------------------------------------------

async function bookingRowKeys(tx: Tx, dayId: string, role: 'farrier' | 'apprentice' | 'barn_manager'): Promise<Record<string, unknown>[]> {
  await sweepDay(tx, dayId, null);
  const rows = await tx.query(
    `select b.*, h.name as horse_name, h.stall as horse_stall, u.name as owner_name, u.email as owner_email, u.phone as owner_phone,
            s.time as slot_time,
            v.id as visit_id, v.status as visit_status,
            i.status as invoice_status, i.total_cents as invoice_total_cents
     from bookings b
     join horses h on h.id = b.horse_id
     join users u on u.id = b.owner_id
     join slots s on s.id = b.slot_id
     left join visits v on v.booking_id = b.id
     left join invoices i on i.booking_id = b.id and i.kind = (case when b.status in ('cancelled_late','no_show') then 'trip' else 'visit' end)
     where b.barn_day_id = $1 and b.status <> 'held'
     order by s.idx`,
    [dayId]
  );
  if (role === 'barn_manager') {
    return rows
      .filter((b: Row) => ['confirmed', 'worked', 'no_show'].includes(b.status))
      .map((b: Row) => ({ slot_time: b.slot_time, horse_name: b.horse_name, stall: b.horse_stall }));
  }
  const out = [];
  for (const b of rows) {
    if (role === 'farrier') {
      out.push({
        booking_id: b.id, number: b.number, slot_time: b.slot_time,
        horse_id: b.horse_id, horse_name: b.horse_name, stall: b.horse_stall,
        status: b.status, owner_name: b.owner_name, owner_email: b.owner_email, owner_phone: b.owner_phone,
        trip_share_cents: b.trip_share_cents, visit_id: b.visit_id, visit_status: b.visit_status,
        invoice_status: b.invoice_status, invoice_total_cents: b.invoice_total_cents
      });
    } else {
      out.push({
        booking_id: b.id, slot_time: b.slot_time, horse_id: b.horse_id, horse_name: b.horse_name,
        stall: b.horse_stall, status: b.status, visit_id: b.visit_id, visit_status: b.visit_status
      });
    }
  }
  return out;
}

async function dayBookings(ctx: Ctx, dayId: string): Promise<number> {
  const c = ctx.caller!;
  if (!c) throw new AppError(401, 'unauthenticated');
  if (c.type === 'token') {
    // tokens act as the farrier for read routes
  } else if (!['farrier', 'apprentice', 'barn_manager'].includes(c.role)) {
    throw new AppError(403, 'forbidden');
  }
  const role: 'farrier' | 'apprentice' | 'barn_manager' = c.type === 'token' ? 'farrier' : (c.role as 'farrier' | 'apprentice' | 'barn_manager');
  const rows = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return null;
    if (c.type === 'session' && c.role === 'barn_manager') {
      const me = (await tx.query(`select barn_id from users where id = $1`, [c.id]))[0];
      if (d.barn_id !== me.barn_id) return null;
    }
    return bookingRowKeys(tx, dayId, role);
  });
  if (rows === null) throw new AppError(404, 'not_found');
  send(ctx.res, ctx.requestId, 200, rows);
  return 200;
}

async function waitlist(ctx: Ctx, dayId: string): Promise<number> {
  const c = ctx.caller!;
  if (ctx.method === 'GET') {
    if (!(c && (c.type === 'token' || (c.type === 'session' && c.role === 'farrier')))) throw new AppError(403, 'forbidden');
    const rows = await withTx(async tx => {
      const w = await tx.query(
        `select w.*, h.name as horse_name from waitlist w join horses h on h.id = w.horse_id
         where w.barn_day_id = $1 order by w.joined_at, w.seq`,
        [dayId]
      );
      let pos = 1;
      return w.map((r: Row) => ({ id: r.id, position: pos++, horse: { id: r.horse_id, name: r.horse_name }, joined_at: printInstant(r.joined_at) }));
    });
    send(ctx.res, ctx.requestId, 200, rows);
    return 200;
  }
  if (ctx.method === 'POST') {
    const owner = requireSession(ctx.caller);
    if (owner.role !== 'owner') throw new AppError(403, 'forbidden');
    const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
    await takeAllowance(ctx, 'HOLD', owner.id);
    const horseId = typeof body.horse_id === 'string' ? body.horse_id : '';
    const cardToken = typeof body.card_token === 'string' ? body.card_token : '';
    const outcome = cardOutcome(cardToken);
    const errors: Record<string, string> = {};
    if (/\d{12,}/.test(cardToken)) errors.card_token = 'Enter a test card token, never a card number.';
    else if (!CARD_LABELS[cardToken]) errors.card_token = 'Choose one of the test cards.';
    const result = await withTx(async tx => {
      const d = await lockDay(tx, dayId);
      if (!d) return { notFound: true };
      await sweepDay(tx, dayId, null);
      await offerPass(tx, dayId, null);
      const { count } = await bookedCount(tx, dayId);
      if (await ownerBlocked(tx, owner.id)) return { blocked: true };
      const horse = (await tx.query(`select * from horses where id = $1`, [horseId]))[0];
      if (!horse || horse.owner_id !== owner.id || horse.barn_id !== d.barn_id) return { badHorse: true };
      const existing = await tx.query(
        `select 1 from bookings where barn_day_id = $1 and horse_id = $2 and status in ('held','confirmed','worked','no_show')`,
        [dayId, horseId]
      );
      if (existing.length > 0) return { alreadyBooked: true };
      const onList = await tx.query(`select 1 from waitlist where barn_day_id = $1 and horse_id = $2`, [dayId, horseId]);
      if (onList.length > 0) return { alreadyOnList: true };
      if (d.status !== 'published' || count < d.slot_count) return { dayNotFull: true };
      return { ok: true, d };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    if (result.blocked) throw new AppError(409, 'account_blocked');
    if (result.alreadyBooked) throw new AppError(409, 'horse_already_booked');
    if (result.alreadyOnList) throw new AppError(409, 'already_on_waitlist');
    if (result.badHorse) throw new ValidationError({ horse_id: 'This is required.' });
    if (result.dayNotFull) throw new AppError(409, 'day_not_full');
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const entry = await withTx(async tx => {
      await lockDay(tx, dayId);
      const w = await tx.query(
        `select w.*, h.name as horse_name from waitlist w join horses h on h.id = w.horse_id
         where w.barn_day_id = $1 order by w.joined_at, w.seq`,
        [dayId]
      );
      const pos = w.length + 1;
      const id = newId('wai');
      await tx.query(
        `insert into waitlist(id, barn_day_id, horse_id, owner_id, joined_at) values($1,$2,$3,$4,$5)`,
        [id, dayId, horseId, owner.id, now()]
      );
      await tx.query(`update users set card_token = $2, card_last4 = $3 where id = $1`, [owner.id, cardToken, outcome.last4]);
      return { id, position: pos, horse_id: horseId, horse_name: (await tx.query(`select name from horses where id = $1`, [horseId]))[0].name };
    });
    send(ctx.res, ctx.requestId, 201, { id: entry.id, position: entry.position, horse: { id: horseId, name: entry.horse_name } });
    return 201;
  }
  throw new AppError(404, 'not_found');
}

async function allocation(ctx: Ctx, dayId: string): Promise<number> {
  const c = ctx.caller!;
  if (!(c && (c.type === 'token' || (c.type === 'session' && c.role === 'farrier')))) throw new AppError(403, 'forbidden');
  const body = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return null;
    if (d.status === 'draft' || d.status === 'published') throw new AppError(409, 'not_started');
    const shares = await tx.query(
      `select b.*, h.name as horse_name from bookings b join horses h on h.id = b.horse_id
       where b.barn_day_id = $1 and b.status in ('confirmed','worked','cancelled_late','no_show','excused')
       order by b.number`,
      [dayId]
    );
    const adjustments = await tx.query(
      `select a.* from adjustments a where a.barn_day_id = $1 order by a.seq`,
      [dayId]
    );
    return {
      barn_day_id: dayId,
      trip_fee_cents: d.trip_fee_cents,
      shares: shares.map((b: Row) => ({
        booking_id: b.id, number: b.number, horse: { id: b.horse_id, name: b.horse_name },
        status: b.status, initial_cents: b.initial_cents ?? 0, share_cents: b.trip_share_cents ?? 0
      })),
      adjustments: adjustments.map((a: Row) => ({
        seq: a.seq, booking_id: a.booking_id, number: (shares.find((s: Row) => s.id === a.booking_id)?.number) ?? 0,
        delta_cents: a.delta_cents, cause_booking_id: a.cause_booking_id, at: printInstant(a.at)
      }))
    };
  });
  if (body === null) throw new AppError(404, 'not_found');
  send(ctx.res, ctx.requestId, 200, body);
  return 200;
}

// --- Holds and bookings --------------------------------------------------------

async function holdSlot(ctx: Ctx, dayId: string): Promise<number> {
  const owner = requireSession(ctx.caller);
  if (owner.role !== 'owner') throw new AppError(403, 'forbidden');
  await takeAllowance(ctx, 'HOLD', owner.id);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const slotId = typeof body.slot_id === 'string' ? body.slot_id : '';
  const horseId = typeof body.horse_id === 'string' ? body.horse_id : '';
  const cardToken = typeof body.card_token === 'string' ? body.card_token : '';

  const depositRow = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return null;
    return { day: d, deposit: (await priceListFor(tx, typeof d.business_date === 'string' ? d.business_date.slice(0, 10) : d.business_date))?.deposit_cents ?? 0 };
  });
  if (!depositRow) throw new AppError(404, 'not_found');
  const needsCard = depositRow.deposit > 0;
  const errors: Record<string, string> = {};
  if (needsCard && !cardToken) errors.card_token = 'Choose one of the test cards.';
  if (cardToken && /\d{12,}/.test(cardToken)) errors.card_token = 'Enter a test card token, never a card number.';
  else if (cardToken && !CARD_LABELS[cardToken]) errors.card_token = 'Choose one of the test cards.';

  const attempt = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) return { notFound: true };
    await sweepDay(tx, dayId, null);
    await offerPass(tx, dayId, null);
    if (await ownerBlocked(tx, owner.id)) return { blocked: true };
    const horse = (await tx.query(`select * from horses where id = $1`, [horseId]))[0];
    if (!horse || horse.owner_id !== owner.id || horse.barn_id !== d.barn_id) return { badHorse: true };
    const liveHorse = await tx.query(
      `select 1 from bookings where barn_day_id = $1 and horse_id = $2 and status in ('held','confirmed','worked','no_show') and (status <> 'held' or hold_expires_at > $3)`,
      [dayId, horseId, now()]
    );
    if (liveHorse.length > 0) return { alreadyBooked: true };
    if (d.status !== 'published' || now().getTime() >= d.starts_at.getTime()) return { notOpen: true };
    const { count, slotIds } = await bookedCount(tx, dayId);
    if (count >= d.slot_count) return { dayFull: true };
    const slot = (await tx.query(`select * from slots where id = $1 and barn_day_id = $2`, [slotId, dayId]))[0];
    if (!slot) return { badSlot: true };
    if (slotIds.has(slot.id)) return { slotTaken: true };
    return { ok: true, day: d, slot, deposit: depositRow.deposit };
  });

  if (attempt.notFound || attempt.badHorse || attempt.badSlot) throw new AppError(404, 'not_found');
  if (attempt.blocked) throw new AppError(409, 'account_blocked');
  if (attempt.alreadyBooked) throw new AppError(409, 'horse_already_booked');
  if (attempt.notOpen) throw new AppError(409, 'not_open_for_booking');
  if (attempt.dayFull) throw new AppError(409, 'day_full');
  if (attempt.slotTaken) throw new AppError(409, 'slot_taken');
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const booking = await withTx(async tx => {
    const d = await lockDay(tx, dayId);
    if (!d) throw new AppError(404, 'not_found');
    await sweepDay(tx, dayId, null);
    await offerPass(tx, dayId, null);
    const { count, slotIds } = await bookedCount(tx, dayId);
    if (await ownerBlocked(tx, owner.id)) throw new AppError(409, 'account_blocked');
    const liveHorse = await tx.query(
      `select 1 from bookings where barn_day_id = $1 and horse_id = $2 and status in ('held','confirmed','worked','no_show') and (status <> 'held' or hold_expires_at > $3)`,
      [dayId, horseId, now()]
    );
    if (liveHorse.length > 0) throw new AppError(409, 'horse_already_booked');
    if (d.status !== 'published' || now().getTime() >= d.starts_at.getTime()) throw new AppError(409, 'not_open_for_booking');
    if (count >= d.slot_count) throw new AppError(409, 'day_full');
    const slot = (await tx.query(`select * from slots where id = $1 and barn_day_id = $2`, [slotId, dayId]))[0];
    if (!slot) throw new AppError(404, 'not_found');
    if (slotIds.has(slot.id)) throw new AppError(409, 'slot_taken');
    const b = await createHoldBooking(tx, d, slot, horseId, owner.id, cardToken, depositRow.deposit, false, { audit: sessionActor(owner.id), requestId: ctx.requestId });
    if (cardToken) {
      const outcome = cardOutcome(cardToken);
      await tx.query(`update users set card_token = $2, card_last4 = $3 where id = $1`, [owner.id, cardToken, outcome.last4]);
    }
    return b;
  });
  send(ctx.res, ctx.requestId, 201, bookingJson(booking, (await withTx(tx => tx.query(`select name from horses where id = $1`, [booking.horse_id])))[0].name, true));
  return 201;
}

// --- Bookings: confirm, cancel, excuse, no-show, visit ----------------------

async function loadOwnBooking(ctx: Ctx, bookingId: string, roles: Array<'owner' | 'farrier'>): Promise<Row | null> {
  const c = ctx.caller!;
  const rows = await withTx(async tx => {
    const bs = await tx.query(`select * from bookings where id = $1`, [bookingId]);
    if (bs.length === 0) return null;
    const b = bs[0];
    if (c.type === 'session' && c.role === 'owner' && b.owner_id !== c.id) return null;
    if (c.type === 'session' && c.role === 'owner' && !roles.includes('owner')) return null;
    return b;
  });
  return rows;
}

async function bookings(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const seg = ctx.url.pathname.slice('/api/bookings'.length).split('/').filter(Boolean);
  const bookingId = seg[0];

  if (seg[1] === 'confirm' && ctx.method === 'POST') {
    const owner = requireSession(ctx.caller);
    if (owner.role !== 'owner') throw new AppError(403, 'forbidden');
    await takeAllowance(ctx, 'HOLD', owner.id);
    const booking = await withTx(async tx => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`day:pending`]);
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return { notFound: true };
      const b = bs[0];
      if (b.owner_id !== owner.id) return { notFound: true };
      const day = await lockDay(tx, b.barn_day_id);
      await sweepDay(tx, b.barn_day_id, null);
      const cur = (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
      if (cur.status !== 'held' || now().getTime() >= cur.hold_expires_at.getTime()) {
        return { expired: true };
      }
      if (cur.status === 'held' && day.status !== 'published' && day.status !== 'in_progress') {
        return { expired: true };
      }
      if (cur.status === 'confirmed') {
        return { already: cur };
      }
      if (cur.status !== 'held') return { expired: true };
      await tx.query(`update bookings set status = 'confirmed', updated_at = $2 where id = $1`, [bookingId, now()]);
      if (cur.payment_id) {
        await captureDeposit(tx, cur.payment_id, cur.deposit_cents, owner.id, ctx.requestId);
      }
      await audit(tx, sessionActor(owner.id), 'confirm', 'booking', bookingId, 'held', 'confirmed', ctx.requestId);
      const fresh = (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
      await offerPass(tx, b.barn_day_id, null);
      return { ok: fresh };
    });
    if (booking.notFound) throw new AppError(404, 'not_found');
    if (booking.expired) throw new AppError(409, 'hold_expired');
    const b = booking.ok ?? booking.already!;
    if (!b) throw new AppError(404, 'not_found');
    // Confirmation email, once.
    const day = (await withTx(tx => tx.query(`select d.*, br.name as barn_name from barn_days d join barns br on br.id = d.barn_id where d.id = $1`, [b.barn_day_id])))[0];
    const horseName = (await withTx(tx => tx.query(`select name from horses where id = $1`, [b.horse_id])))[0].name;
    const email = (await withTx(tx => tx.query(`select email from users where id = $1`, [b.owner_id])))[0].email;
    if (!booking.already) {
      const msg = T.bookingConfirmedEmail(horseName, {
        barnName: day.barn_name,
        businessDate: String(day.business_date).slice(0, 10),
        slotTime: (await withTx(tx => tx.query(`select time from slots where id = $1`, [b.slot_id])))[0].time
      }, day.cancellation_cutoff_at);
      await sendRequestEmail({ to: email, subject: msg.subject, body: msg.body });
    }
    send(ctx.res, ctx.requestId, 200, bookingJson(b, horseName, true));
    return 200;
  }

  if (ctx.method === 'DELETE' && seg.length === 1) {
    const owner = requireSession(ctx.caller);
    if (owner.role !== 'owner') throw new AppError(403, 'forbidden');
    const result = await withTx(async tx => {
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return { notFound: true };
      const b = bs[0];
      if (b.owner_id !== owner.id) return { notFound: true };
      if (b.status !== 'held') return { notFound: true };
      const day = await lockDay(tx, b.barn_day_id);
      await sweepDay(tx, b.barn_day_id, null);
      const cur = (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
      if (cur.status !== 'held' || now().getTime() >= cur.hold_expires_at.getTime()) return { notFound: true };
      await tx.query(`update bookings set status = 'released', updated_at = $2 where id = $1`, [bookingId, now()]);
      if (cur.payment_id) {
        await tx.query(`update payments set status = 'voided', updated_at = $2 where id = $1 and status = 'authorized'`, [cur.payment_id, now()]);
        await audit(tx, sessionActor(owner.id), 'void', 'payment', cur.payment_id, 'authorized', 'voided', ctx.requestId);
      }
      await audit(tx, sessionActor(owner.id), 'release', 'booking', bookingId, 'held', 'released', ctx.requestId);
      await offerPass(tx, b.barn_day_id, null);
      return { ok: true };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    send204(ctx.res, ctx.requestId);
    return 204;
  }

  if (seg[1] === 'cancellation-preview' && ctx.method === 'GET') {
    const c2 = requireSession(ctx.caller);
    if (!['owner', 'farrier'].includes(c2.role)) throw new AppError(403, 'forbidden');
    const b = await loadOwnBooking(ctx, bookingId, ['owner', 'farrier']);
    if (!b) throw new AppError(404, 'not_found');
    const day = (await withTx(tx => tx.query(`select * from barn_days where id = $1`, [b.barn_day_id])))[0];
    const late = now().getTime() >= day.cancellation_cutoff_at.getTime();
    const captured = b.payment_id ? await capturedCents(b.payment_id) : 0;
    send(ctx.res, ctx.requestId, 200, {
      late,
      cutoff_at: printInstant(day.cancellation_cutoff_at),
      deposit_cents: captured,
      deposit_outcome: captured > 0 ? (late ? 'keep' : 'refund') : 'none'
    });
    return 200;
  }

  if (seg[1] === 'cancel' && ctx.method === 'POST') {
    const c2 = requireSession(ctx.caller);
    if (!['owner', 'farrier'].includes(c2.role)) throw new AppError(403, 'forbidden');
    const result = await withTx(async tx => {
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return { notFound: true };
      const b = bs[0];
      if (c2.type === 'session' && c2.role === 'owner' && b.owner_id !== c2.id) return { notFound: true };
      const day = await lockDay(tx, b.barn_day_id);
      if (b.status !== 'confirmed') {
        throw new IllegalTransition(b.status, 'cancel');
      }
      if (day.status !== 'published' && day.status !== 'draft') {
        throw new AppError(409, 'day_started');
      }
      const t = now();
      const { booking, tripShareApplies, refunded } = await cancelBookingRow(tx, b, t, c2.id, ctx.requestId, false);
      await offerPass(tx, b.barn_day_id, null);
      return { booking, tripShareApplies, refunded, day };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    const b = result.booking!;
    const horseName = (await withTx(tx => tx.query(`select name from horses where id = $1`, [b.horse_id])))[0].name;
    const barn = (await withTx(tx => tx.query(`select br.name as name from barn_days d join barns br on br.id = d.barn_id where d.id = $1`, [b.barn_day_id])))[0];
    const email = (await withTx(tx => tx.query(`select email from users where id = $1`, [b.owner_id])))[0].email;
    const captured = b.payment_id ? await capturedCents(b.payment_id) : 0;
    const refunded = result.refunded ?? 0;
    const msg = T.bookingCancelledEmail(horseName, {
      barnName: barn.name,
      businessDate: String((await withTx(tx => tx.query(`select business_date from barn_days where id = $1`, [b.barn_day_id])))[0].business_date).slice(0, 10)
    }, result.tripShareApplies ?? false, captured, refunded > 0);
    await sendRequestEmail({ to: email, subject: msg.subject, body: msg.body });
    send(ctx.res, ctx.requestId, 200, {
      booking: bookingJson(b, horseName, true),
      trip_share_applies: result.tripShareApplies,
      decided_at: printInstant(b.decided_at),
      deposit_outcome: captured > 0 ? (refunded > 0 ? 'refund' : 'keep') : 'none',
      refunded_cents: refunded
    });
    return 200;
  }

  if (seg[1] === 'excuse' && ctx.method === 'POST') {
    const c2 = await requireFarrierSession(ctx);
    const result = await withTx(async tx => {
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return { notFound: true };
      const b = bs[0];
      const day = await lockDay(tx, b.barn_day_id);
      if (b.status !== 'confirmed') throw new IllegalTransition(b.status, 'excuse');
      if (day.status !== 'in_progress') throw new AppError(409, 'day_not_in_progress');
      const { changed, allocation: _ } = await excuseBooking(tx, b, { audit: sessionActor(c2.id), requestId: ctx.requestId });
      const fresh = (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
      // Emit booking_moved per changed row then allocation_adjusted.
      for (const ch of changed) {
        const row = await bookingRowFor(tx, ch.booking.id, 'farrier');
        await emitDayEvent(tx, b.barn_day_id, 'farrier', 'booking_moved', row);
        if (ch.booking.id === bookingId) {
          const apprRow = await bookingRowFor(tx, bookingId, 'apprentice');
          await emitDayEvent(tx, b.barn_day_id, 'apprentice', 'booking_moved', apprRow);
          await emitDayEvent(tx, b.barn_day_id, 'barn_manager', 'booking_removed', await bookingRowFor(tx, bookingId, 'barn_manager'));
        }
      }
      if (changed.some((ch) => ch.to !== ch.from)) {
        const alloc = await allocationBody(tx, b.barn_day_id);
        await emitDayEvent(tx, b.barn_day_id, 'farrier', 'allocation_adjusted', alloc);
      }
      // Refund the deposit like an in-time cancellation and email the owner.
      const t = now();
      let refunded = 0;
      if (b.payment_id) {
        const captured = await capturedCents(b.payment_id);
        if (captured > 0) {
          refunded = await refundDeposit(tx, b.payment_id, captured, t, ctx.requestId);
        }
      }
      const alloc = await allocationBody(tx, b.barn_day_id);
      return { booking: fresh, changed, refunded, alloc };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    const b = result.booking!;
    const horseName = (await withTx(tx => tx.query(`select name from horses where id = $1`, [b.horse_id])))[0].name;
    const barnDay = (await withTx(tx => tx.query(`select d.business_date, br.name as barn_name from barn_days d join barns br on br.id = d.barn_id where d.id = $1`, [b.barn_day_id])))[0];
    const email = (await withTx(tx => tx.query(`select email from users where id = $1`, [b.owner_id])))[0].email;
    const msg = T.horseExcusedEmail(horseName, { barnName: barnDay.barn_name, businessDate: String(barnDay.business_date).slice(0, 10) }, b.deposit_cents);
    await sendRequestEmail({ to: email, subject: msg.subject, body: msg.body });
    send(ctx.res, ctx.requestId, 200, { booking: bookingJson(b, horseName, true), allocation: result.alloc });
    return 200;
  }

  if (seg[1] === 'no-show' && ctx.method === 'POST') {
    const c2 = await requireFarrierSession(ctx);
    const b = await withTx(async tx => {
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return null;
      const bk = bs[0];
      const day = await lockDay(tx, bk.barn_day_id);
      if (bk.status !== 'confirmed') throw new IllegalTransition(bk.status, 'no_show');
      if (day.status !== 'in_progress') throw new AppError(409, 'day_not_in_progress');
      await tx.query(`update bookings set status = 'no_show', updated_at = $2 where id = $1`, [bookingId, now()]);
      if (bk.payment_id) {
        await tx.query(`update payments set disposition = 'forfeited', updated_at = $2 where id = $1`, [bk.payment_id, now()]);
      }
      await audit(tx, sessionActor(c2.id), 'no_show', 'booking', bookingId, 'confirmed', 'no_show', ctx.requestId);
      await emitDayEvent(tx, bk.barn_day_id, 'farrier', 'booking_moved', await bookingRowFor(tx, bookingId, 'farrier'));
      await emitDayEvent(tx, bk.barn_day_id, 'apprentice', 'booking_moved', await bookingRowFor(tx, bookingId, 'apprentice'));
      await emitDayEvent(tx, bk.barn_day_id, 'barn_manager', 'booking_removed', await bookingRowFor(tx, bookingId, 'barn_manager'));
      return (await tx.query(`select * from bookings where id = $1`, [bookingId]))[0];
    });
    if (!b) throw new AppError(404, 'not_found');
    const horseName = (await withTx(tx => tx.query(`select name from horses where id = $1`, [b.horse_id])))[0].name;
    send(ctx.res, ctx.requestId, 200, bookingJson(b, horseName, false));
    return 200;
  }

  if (seg[1] === 'visit' && ctx.method === 'POST') {
    const c2 = await requireFarrierSession(ctx);
    const result = await withTx(async tx => {
      const bs = await tx.query(`select * from bookings where id = $1 for update`, [bookingId]);
      if (bs.length === 0) return { notFound: true };
      const b = bs[0];
      const day = await lockDay(tx, b.barn_day_id);
      if (day.status !== 'in_progress') throw new AppError(409, 'day_not_in_progress');
      if (b.status !== 'confirmed') throw new IllegalTransition(b.status, 'open_visit');
      await tx.query(`update bookings set status = 'worked', updated_at = $2 where id = $1`, [bookingId, now()]);
      await audit(tx, sessionActor(c2.id), 'worked', 'booking', bookingId, 'confirmed', 'worked', ctx.requestId);
      const vid = newId('vst');
      await tx.query(
        `insert into visits(id, booking_id, horse_id, business_date, status, note, created_at)
         values($1,$2,$3,$4,'open','',$5)`,
        [vid, bookingId, b.horse_id, String(day.business_date).slice(0, 10), now()]
      );
      await audit(tx, sessionActor(c2.id), 'open', 'visit', vid, null, 'open', ctx.requestId);
      await emitDayEvent(tx, b.barn_day_id, 'farrier', 'booking_moved', await bookingRowFor(tx, bookingId, 'farrier'));
      await emitDayEvent(tx, b.barn_day_id, 'apprentice', 'booking_moved', await bookingRowFor(tx, bookingId, 'apprentice'));
      return { visit: (await tx.query(`select * from visits where id = $1`, [vid]))[0] };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    const visitJsonOut = await withTx(tx => visitJson(tx, result.visit!, c2));
    send(ctx.res, ctx.requestId, 201, visitJsonOut);
    return 201;
  }

  throw new AppError(404, 'not_found');
}

// --- Deposit helpers (DP-66, DP-94, DP-105) ----------------------------------

async function capturedCents(paymentId: string): Promise<number> {
  const rows = await withTx(tx => tx.query(`select captured_cents from payments where id = $1`, [paymentId]));
  return rows[0]?.captured_cents ?? 0;
}

/** Capture a deposit: Kill Bill first when reachable, then rows (Deposits). */
async function captureDeposit(tx: Tx, paymentId: string, amountCents: number, userId: string, requestId: string): Promise<void> {
  const t = now();
  const payment = (await tx.query(`select * from payments where id = $1`, [paymentId]))[0];
  if (!payment || payment.status !== 'authorized') return;
  const owner = (await tx.query(`select * from users where id = $1`, [payment.owner_id]))[0];
  await tx.query(
    `update payments set status = 'captured', captured_cents = $2, disposition = 'held', killbill_status = 'pending', pending_since = $3, updated_at = $4 where id = $1`,
    [paymentId, amountCents, t, t]
  );
  await audit(tx, sessionActor(userId), 'capture', 'payment', paymentId, 'authorized', 'captured', requestId);
  const booking = (await tx.query(
    `select b.*, h.name as horse_name from bookings b join horses h on h.id = b.horse_id where b.payment_id = $1`, [paymentId]))[0];
  const businessDate = String((await tx.query(`select business_date from barn_days where id = $1`, [booking.barn_day_id]))[0].business_date).slice(0, 10);
  // Kill Bill: deposit invoice + external payment. Failures leave the leg pending.
  try {
    const accountId = await kb.ensureAccount(owner.email, owner.name);
    const marker = `[${paymentId}]`;
    let kbInvoiceId = await kb.findInvoiceIdByMarker(accountId, marker);
    if (!kbInvoiceId) {
      const created = await kb.createInvoiceWithCharges(accountId, businessDate, [
        { description: `Booking deposit — ${booking.horse_name} ${businessDate} [${paymentId}]`, amount_cents: amountCents }
      ]);
      kbInvoiceId = created.invoiceId;
    }
    const pay = await kb.createExternalPayment(kbInvoiceId!, accountId, amountCents, paymentId, `${paymentId}:capture`);
    await tx.query(
      `update payments set killbill_status = 'recorded', pending_since = null, killbill_payment_id = $2, killbill_invoice_id = $3 where id = $1`,
      [paymentId, pay.paymentId, kbInvoiceId]
    );
    await ledgerEntry(tx, 'deposit_captured', amountCents, t, owner.id, booking.horse_id, businessDate, null, paymentId);
  } catch {
    // stays pending; the reconciler finishes it under Billing outage
  }
}

/** In-time cancel / excuse refund of the captured deposit (DP-94, DP-95). */
async function refundDeposit(tx: Tx, paymentId: string, amountCents: number, at: Date, requestId: string): Promise<number> {
  const payment = (await tx.query(`select * from payments where id = $1`, [paymentId]))[0];
  const refundId = newId('rfd');
  await tx.query(
    `insert into refunds(id, payment_id, amount_cents, killbill_status, pending_since, created_at)
     values($1,$2,$3,'pending',$4,$5)`,
    [refundId, paymentId, amountCents, at, at]
  );
  await tx.query(
    `update payments set status = 'refunded', refunded_cents = refunded_cents + $2, disposition = null, updated_at = $3 where id = $1`,
    [paymentId, amountCents, at]
  );
  await audit(tx, systemActor(), 'refund', 'payment', paymentId, 'captured', 'refunded', requestId);
  const owner = (await tx.query(`select * from users where id = $1`, [payment.owner_id]))[0];
  const date = businessDate(practiceZoneName(), at);
  try {
    const accountId = await kb.ensureAccount(owner.email, owner.name);
    const kbPaymentId = payment.killbill_payment_id
      ?? (payment.killbill_invoice_id ? await kb.findPaymentIdByTransactionKey(payment.killbill_invoice_id, `${paymentId}:capture`) : null);
    if (kbPaymentId) {
      const kbInvoiceId = payment.killbill_invoice_id
        ?? (await kb.findInvoiceIdByMarker(accountId, `[${paymentId}]`));
      await kb.createRefund(accountId, kbPaymentId, kbInvoiceId!, amountCents, refundId);
      await tx.query(`update refunds set killbill_status = 'recorded', pending_since = null, ledger_at = $2 where id = $1`, [refundId, at]);
    }
    await ledgerEntry(tx, 'refund', amountCents, at, owner.id, null, date, null, paymentId);
  } catch {
    // refund stays pending; reconciler finishes it
  }
  return amountCents;
}

/**
 * Cancels a confirmed booking from one stored decision instant: verdict,
 * deposit outcome and refund all come from `decidedAt` (DP-105).
 */
async function cancelBookingRow(tx: Tx, b: Row, decidedAt: Date, userId: string, requestId: string, dayCancel: boolean): Promise<{ booking: Row; tripShareApplies: boolean; refunded: number }> {
  const day = await loadDay(tx, b.barn_day_id);
  const late = decidedAt.getTime() >= day.cancellation_cutoff_at.getTime();
  const newStatus = late ? 'cancelled_late' : 'cancelled_in_time';
  await tx.query(`update bookings set status = $2, decided_at = $3, updated_at = $3 where id = $1`, [b.id, newStatus, decidedAt]);
  await audit(tx, sessionActor(userId), 'cancel', 'booking', b.id, 'confirmed', newStatus, requestId);
  let refunded = 0;
  if (b.payment_id) {
    const captured = await capturedCentsInTx(tx, b.payment_id);
    if (captured > 0) {
      if (late) {
        await tx.query(`update payments set disposition = 'forfeited', updated_at = $2 where id = $1`, [b.payment_id, decidedAt]);
      } else {
        refunded = await refundDeposit(tx, b.payment_id, captured, decidedAt, requestId);
      }
    }
  }
  const fresh = (await tx.query(`select * from bookings where id = $1`, [b.id]))[0];
  await emitDayEvent(tx, b.barn_day_id, 'farrier', 'booking_moved', await bookingRowFor(tx, b.id, 'farrier'));
  await emitDayEvent(tx, b.barn_day_id, 'apprentice', 'booking_moved', await bookingRowFor(tx, b.id, 'apprentice'));
  await emitDayEvent(tx, b.barn_day_id, 'barn_manager', 'booking_removed', await bookingRowFor(tx, b.id, 'barn_manager'));
  return { booking: fresh, tripShareApplies: late, refunded };
}

async function capturedCentsInTx(tx: Tx, paymentId: string): Promise<number> {
  const rows = await tx.query(`select captured_cents from payments where id = $1`, [paymentId]);
  return rows[0]?.captured_cents ?? 0;
}

async function bookingRowFor(tx: Tx, bookingId: string, role: 'farrier' | 'apprentice' | 'barn_manager'): Promise<Record<string, unknown>> {
  const b = (await tx.query(
    `select b.*, h.name as horse_name, h.stall as horse_stall, u.name as owner_name, u.email as owner_email, u.phone as owner_phone,
            s.time as slot_time, v.id as visit_id, v.status as visit_status,
            i.status as invoice_status, i.total_cents as invoice_total_cents
     from bookings b
     join horses h on h.id = b.horse_id
     join users u on u.id = b.owner_id
     join slots s on s.id = b.slot_id
     left join visits v on v.booking_id = b.id
     left join invoices i on i.booking_id = b.id and i.kind = (case when b.status in ('cancelled_late','no_show') then 'trip' else 'visit' end)
     where b.id = $1`,
    [bookingId]
  ))[0];
  if (!b) return {};
  if (role === 'barn_manager') {
    return ['confirmed', 'worked', 'no_show'].includes(b.status)
      ? { slot_time: b.slot_time, horse_name: b.horse_name, stall: b.horse_stall }
      : {};
  }
  if (role === 'apprentice') {
    return {
      booking_id: b.id, slot_time: b.slot_time, horse_id: b.horse_id, horse_name: b.horse_name,
      stall: b.horse_stall, status: b.status, visit_id: b.visit_id, visit_status: b.visit_status
    };
  }
  return {
    booking_id: b.id, number: b.number, slot_time: b.slot_time,
    horse_id: b.horse_id, horse_name: b.horse_name, stall: b.horse_stall,
    status: b.status, owner_name: b.owner_name, owner_email: b.owner_email, owner_phone: b.owner_phone,
    trip_share_cents: b.trip_share_cents, visit_id: b.visit_id, visit_status: b.visit_status,
    invoice_status: b.invoice_status, invoice_total_cents: b.invoice_total_cents
  };
}

async function allocationBody(tx: Tx, dayId: string): Promise<Record<string, unknown>> {
  const d = await loadDay(tx, dayId);
  const shares = await tx.query(
    `select b.*, h.name as horse_name from bookings b join horses h on h.id = b.horse_id
     where b.barn_day_id = $1 and b.status in ('confirmed','worked','cancelled_late','no_show','excused')
     order by b.number`,
    [dayId]
  );
  const adjustments = await tx.query(`select * from adjustments where barn_day_id = $1 order by seq`, [dayId]);
  const numberById = new Map<string, number>();
  for (const s of shares) numberById.set(s.id, s.number);
  return {
    barn_day_id: dayId,
    trip_fee_cents: d.trip_fee_cents,
    shares: shares.map((b: Row) => ({
      booking_id: b.id, number: b.number, horse: { id: b.horse_id, name: b.horse_name },
      status: b.status, initial_cents: b.initial_cents ?? 0, share_cents: b.trip_share_cents ?? 0
    })),
    adjustments: adjustments.map((a: Row) => ({
      seq: a.seq, booking_id: a.booking_id, number: numberById.get(a.booking_id) ?? 0,
      delta_cents: a.delta_cents, cause_booking_id: a.cause_booking_id, at: printInstant(a.at)
    }))
  };
}

/** Trip-only invoice for a late-cancelled or no-show booking (DP-30). */
async function createTripOnlyInvoice(tx: Tx, b: Row, requestId: string): Promise<void> {
  const share = b.trip_share_cents ?? 0;
  if (share <= 0) return;
  const horse = (await tx.query(`select * from horses where id = $1`, [b.horse_id]))[0];
  const day = (await tx.query(`select d.*, br.name as barn_name from barn_days d join barns br on br.id = d.barn_id where d.id = $1`, [b.barn_day_id]))[0];
  const businessDate = String(day.business_date).slice(0, 10);
  const reason = b.status === 'no_show' ? 'no-show' : 'cancelled late';
  const items = [
    { description: `Trip share — ${day.barn_name} ${businessDate} (${horse.name}, ${reason})`, amount_cents: share }
  ];
  let depositCredit = 0;
  if (b.payment_id) {
    const captured = await capturedCentsInTx(tx, b.payment_id);
    depositCredit = Math.min(captured, share);
    if (depositCredit > 0) {
      items.push({ description: `Deposit credit — ${horse.name} ${businessDate}`, amount_cents: -depositCredit });
    }
  }
  const total = items.reduce((s, i) => s + i.amount_cents, 0);
  const invoiceId = newId('inv');
  await tx.query(
    `insert into invoices(id, kind, status, horse_id, owner_id, booking_id, business_date, items, total_cents, balance_cents, pending_since, created_at)
     values($1,'trip','pending',$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
    [invoiceId, b.horse_id, b.owner_id, b.id, businessDate, JSON.stringify(items), total, now(), now()]
  );
  await audit(tx, systemActor(), 'create', 'invoice', invoiceId, null, 'pending', requestId);
  if (depositCredit > 0 && b.payment_id) {
    await applyDepositCredit(tx, b.payment_id, depositCredit, invoiceId, requestId);
  }
}

/** One paired refund and payment per deposit credit (DP-69). */
async function applyDepositCredit(tx: Tx, paymentId: string, creditCents: number, invoiceId: string, requestId: string): Promise<void> {
  const invoice = (await tx.query(`select * from invoices where id = $1`, [invoiceId]))[0];
  const t = now();
  const outRefundId = newId('rfd');
  await tx.query(
    `insert into refunds(id, payment_id, amount_cents, killbill_status, pending_since, created_at)
     values($1,$2,$3,'pending',$4,$5)`,
    [outRefundId, paymentId, creditCents, t, t]
  );
  const businessDate = String(invoice.business_date).slice(0, 10);
  await ledgerEntry(tx, 'deposit_transfer_out', creditCents, t, invoice.owner_id, invoice.horse_id, businessDate, invoiceId, paymentId);
  await ledgerEntry(tx, 'deposit_transfer_in', creditCents, t, invoice.owner_id, invoice.horse_id, businessDate, invoiceId, paymentId);
  await tx.query(
    `update payments set applied_cents = applied_cents + $2, disposition = 'applied',
      status = case when captured_cents <= refunded_cents + applied_cents + $2 then 'refunded' else 'partially_refunded' end,
      updated_at = $3
     where id = $1`,
    [paymentId, creditCents, t]
  );
  await audit(tx, systemActor(), 'apply', 'payment', paymentId, null, 'applied', requestId);
}

// --- Visits, photos, marks, close (DP-18, DP-19, DP-21, DP-23, DP-24, DP-51, DP-62, DP-65) ---

async function lockVisit(tx: Tx, visitId: string): Promise<Row | null> {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`visit:${visitId}`]);
  const rows = await tx.query(`select * from visits where id = $1`, [visitId]);
  return rows[0] ?? null;
}

async function canSeeVisit(caller: Caller | null, visit: Row): Promise<boolean> {
  if (!caller) return false;
  if (caller.type === 'token') return true;
  if (caller.role === 'farrier' || caller.role === 'apprentice') return true;
  if (caller.role === 'owner') {
    const horse = await withTx(tx => tx.query(`select owner_id from horses where id = $1`, [visit.horse_id]));
    return horse[0]?.owner_id === caller.id;
  }
  return false;
}

async function visits(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const seg = ctx.url.pathname.slice('/api/visits'.length).split('/').filter(Boolean);
  const visitId = seg[0];

  if (ctx.method === 'GET' && seg.length === 1) {
    requireRole(c, ['farrier', 'apprentice', 'owner']);
    const out = await withTx(async tx => {
      const v = await lockVisit(tx, visitId);
      if (!v) return null;
      if (!(await canSeeVisit(c, v))) return null;
      if (c.type === 'session' && c.role === 'owner' && v.status === 'open') return null;
      return visitJson(tx, v, c);
    });
    if (!out) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, out);
    return 200;
  }

  if (seg[1] === 'photos' && ctx.method === 'POST') return uploadPhoto(ctx, visitId);
  if (seg[1] === 'uploads' && ctx.method === 'POST') return createUpload(ctx, visitId);
  if (seg[1] === 'uploads' && ctx.method === 'GET') return listUploads(ctx, visitId);
  if (seg[1] === 'close' && ctx.method === 'POST') return closeVisit(ctx, visitId);
  if (seg[1] === 'hooves') {
    const hoof = seg[2];
    if (seg[3] === 'marks' && ctx.method === 'PUT') return saveMarks(ctx, visitId, hoof);
    if (seg[3] === 'marks' && seg[4] === 'history' && ctx.method === 'GET') return marksHistory(ctx, visitId, hoof);
    if (seg[3] === 'marks' && seg[4] === 'restore' && ctx.method === 'POST') return restoreMarks(ctx, visitId, hoof);
  }
  throw new AppError(404, 'not_found');
}

const HOOVES = ['LF', 'RF', 'LH', 'RH'];

/** Stores only real JPEG/PNG/HEIC images, upright, metadata-free (DP-19, DP-101). */
async function storeImage(buf: Buffer): Promise<{ ok: true; data: Buffer; contentType: string; width: number; height: number } | { ok: false; code: 'unsupported_image' | 'photo_too_large' }> {
  if (buf.length > 8000000) return { ok: false, code: 'photo_too_large' };
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isHeic = buf.length > 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['heic', 'heix', 'mif1'].includes(buf.subarray(8, 12).toString('ascii'));
  if (!isJpeg && !isPng && !isHeic) return { ok: false, code: 'unsupported_image' };
  try {
    const image = sharp(buf, { failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || !meta.format) return { ok: false, code: 'unsupported_image' };
    // Apply declared orientation so the stored image is upright, then strip metadata.
    const upright = await image.rotate().toBuffer();
    const uprightMeta = await sharp(upright).metadata();
    if (isHeic) {
      const jpeg = await sharp(upright).jpeg().toBuffer();
      return { ok: true, data: jpeg, contentType: 'image/jpeg', width: uprightMeta.width!, height: uprightMeta.height! };
    }
    if (meta.format === 'jpeg') {
      const jpeg = await sharp(upright).jpeg().toBuffer();
      return { ok: true, data: jpeg, contentType: 'image/jpeg', width: uprightMeta.width!, height: uprightMeta.height! };
    }
    const png = await sharp(upright).png().toBuffer();
    return { ok: true, data: png, contentType: 'image/png', width: uprightMeta.width!, height: uprightMeta.height! };
  } catch {
    return { ok: false, code: 'unsupported_image' };
  }
}

async function multipartFile(ctx: Ctx): Promise<{ fields: Record<string, string>; file: Buffer } | null> {
  const raw = await readBody(ctx.req, MULTIPART_LIMIT);
  const ct = String(ctx.req.headers['content-type'] ?? '');
  if (!ct.startsWith('multipart/form-data')) throw new AppError(415, 'unsupported_media_type');
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  if (!m) throw new AppError(415, 'unsupported_media_type');
  const boundary = `--${m[1] ?? m[2]}`;
  const sep = Buffer.from(boundary);
  const fields: Record<string, string> = {};
  let file: Buffer | null = null;
  let pos = 0;
  while (true) {
    const start = raw.indexOf(sep, pos);
    if (start < 0) break;
    const headerStart = start + sep.length;
    if (raw[headerStart] === 0x2d && raw[headerStart + 1] === 0x2d) break;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd < 0) break;
    const headerText = raw.slice(headerStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextBoundary = raw.indexOf(Buffer.from(`\r\n${boundary}`), bodyStart);
    if (nextBoundary < 0) break;
    const body = raw.slice(bodyStart, nextBoundary);
    const cd = /Content-Disposition:[^\n]*name="([^"]+)"(?:[^\n]*filename="([^"]*)")?/.exec(headerText);
    if (cd) {
      if (cd[2] !== undefined || headerText.includes('filename=')) {
        file = body;
      } else {
        fields[cd[1]] = body.toString('utf8');
      }
    }
    pos = nextBoundary + 2;
  }
  if (!file) return null;
  return { fields, file };
}

async function visitVisibleOr404(ctx: Ctx, visitId: string): Promise<Row> {
  const c = ctx.caller!;
  const visit = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return null;
    if (c.type === 'session' && !['farrier', 'apprentice'].includes(c.role)) return null;
    if (c.type === 'token') return v;
    if (c.role === 'apprentice' || c.role === 'farrier') return v;
    return null;
  });
  if (!visit) throw new AppError(404, 'not_found');
  return visit;
}

async function uploadPhoto(ctx: Ctx, visitId: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  await takeAllowance(ctx, 'UPLOAD', c.id);
  const parsed = await multipartFile(ctx);
  if (!parsed) throw new AppError(422, 'validation', { errors: { file: 'This is required.' } });
  const hoof = parsed.fields['hoof'] ?? '';
  const phase = parsed.fields['phase'] ?? '';
  const errors: Record<string, string> = {};
  if (!HOOVES.includes(hoof)) errors.hoof = 'Enter a number from 1 to 4.';
  if (!['before', 'after'].includes(phase)) errors.phase = 'This is required.';
  const verdict = await storeImage(parsed.file);
  if (!verdict.ok && verdict.code === 'photo_too_large') throw new AppError(413, 'photo_too_large');
  if (!verdict.ok) throw new AppError(415, 'unsupported_image');
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const result = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return { notFound: true };
    if (v.status !== 'open') throw new AppError(409, 'visit_closed');
    const existing = await tx.query(`select 1 from photos where visit_id = $1 and hoof = $2 and phase = $3`, [visitId, hoof, phase]);
    if (existing.length > 0) throw new AppError(409, 'photo_exists');
    const usedBytes = await tx.query(
      `select coalesce(sum(size_bytes), 0)::int as used from photos where visit_id = $1`,
      [visitId]
    );
    const reserved = await tx.query(
      `select coalesce(sum(size_bytes), 0)::int as r from uploads where visit_id = $1 and ended = false and expires_at > $2`,
      [visitId, now()]
    );
    const used = usedBytes[0].used + reserved[0].r;
    if (used + parsed.file.length > config.visitPhotoQuotaBytes) {
      return { quota: Math.max(0, config.visitPhotoQuotaBytes - used) };
    }
    const photoId = newId('pht');
    const key = `visits/${visitId}/${hoof}/${phase}/${photoId}.${verdict.contentType === 'image/png' ? 'png' : 'jpg'}`;
    try {
      await putObject(key, verdict.data, verdict.contentType);
    } catch {
      return { storageDown: true };
    }
    await tx.query(
      `insert into photos(id, visit_id, hoof, phase, content_type, width, height, size_bytes, storage_key, created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [photoId, visitId, hoof, phase, verdict.contentType, verdict.width, verdict.height, verdict.data.length, key, now()]
    );
    await enqueueJob(tx, 'thumbnail', now(), { photo_id: photoId, key });
    await audit(tx, actorOf(ctx).audit, 'upload', 'visit', visitId, null, null, ctx.requestId);
    return { photoId };
  });
  if (result.notFound) throw new AppError(404, 'not_found');
  if (result.quota !== undefined) throw new AppError(409, 'visit_quota_exceeded', { remaining_bytes: result.quota });
  if (result.storageDown) throw new AppError(503, 'storage_unavailable');
  const photo = await withTx(async tx => {
    const rows = await tx.query(`select * from photos where id = $1`, [result.photoId]);
    return photoJson(tx, rows[0]);
  });
  send(ctx.res, ctx.requestId, 201, photo);
  return 201;
}

async function createUpload(ctx: Ctx, visitId: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  await takeAllowance(ctx, 'UPLOAD', c.id);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const hoof = typeof body.hoof === 'string' ? body.hoof : '';
  const phase = typeof body.phase === 'string' ? body.phase : '';
  const sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : NaN;
  const errors: Record<string, string> = {};
  if (!HOOVES.includes(hoof)) errors.hoof = 'Enter a number from 1 to 4.';
  if (!['before', 'after'].includes(phase)) errors.phase = 'This is required.';
  if (!(Number.isInteger(sizeBytes) && sizeBytes >= 0 && sizeBytes <= 8000000)) errors.size_bytes = 'Enter a number from 0 to 8000000.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const result = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return { notFound: true };
    if (v.status !== 'open') throw new AppError(409, 'visit_closed');
    const existing = await tx.query(`select 1 from photos where visit_id = $1 and hoof = $2 and phase = $3`, [visitId, hoof, phase]);
    if (existing.length > 0) throw new AppError(409, 'photo_exists');
    const usedBytes = await tx.query(`select coalesce(sum(size_bytes), 0)::int as used from photos where visit_id = $1`, [visitId]);
    const reserved = await tx.query(
      `select coalesce(sum(size_bytes), 0)::int as r from uploads where visit_id = $1 and ended = false and expires_at > $2`,
      [visitId, now()]
    );
    const used = usedBytes[0].used + reserved[0].r;
    if (used + sizeBytes > config.visitPhotoQuotaBytes) {
      return { quota: Math.max(0, config.visitPhotoQuotaBytes - used) };
    }
    const id = newId('upl');
    await tx.query(
      `insert into uploads(id, visit_id, hoof, phase, size_bytes, chunk_bytes, uploaded_offset, expires_at, created_at)
       values($1,$2,$3,$4,$5,$6,0,$7,$8)`,
      [id, visitId, hoof, phase, sizeBytes, config.uploadChunkBytes, new Date(now().getTime() + config.uploadSessionSeconds * 1000), now()]
    );
    return { id };
  });
  if (result.notFound) throw new AppError(404, 'not_found');
  if (result.quota !== undefined) throw new AppError(409, 'visit_quota_exceeded', { remaining_bytes: result.quota });
  send(ctx.res, ctx.requestId, 201, {
    id: result.id,
    chunk_bytes: config.uploadChunkBytes,
    offset: 0,
    expires_at: printInstant(new Date(now().getTime() + config.uploadSessionSeconds * 1000))
  });
  return 201;
}

async function listUploads(ctx: Ctx, visitId: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  const rows = await withTx(async tx => {
    await lockVisit(tx, visitId);
    return tx.query(
      `select * from uploads where visit_id = $1 and ended = false and expires_at > $2 order by created_at`,
      [visitId, now()]
    );
  });
  send(ctx.res, ctx.requestId, 200, rows.map((u: Row) => ({
    id: u.id, hoof: u.hoof, phase: u.phase, size_bytes: u.size_bytes,
    chunk_bytes: u.chunk_bytes, offset: u.uploaded_offset, expires_at: printInstant(u.expires_at)
  })));
  return 200;
}

async function uploads(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const seg = ctx.url.pathname.slice('/api/uploads'.length).split('/').filter(Boolean);
  const uploadId = seg[0];
  requireRole(c, ['farrier', 'apprentice', 'token']);
  if (ctx.method === 'PATCH') return patchUpload(ctx, uploadId);
  if (ctx.method === 'GET') {
    const u = await withTx(async tx => {
      const rows = await tx.query(`select * from uploads where id = $1`, [uploadId]);
      return rows[0] ?? null;
    });
    if (!u) throw new AppError(404, 'not_found');
    const visit = await withTx(async tx => {
      await lockVisit(tx, u.visit_id);
      return tx.query(`select status from visits where id = $1`, [u.visit_id]);
    });
    if (visit[0].status !== 'open') throw new AppError(409, 'visit_closed');
    if (u.expires_at.getTime() <= now().getTime()) throw new AppError(410, 'upload_expired');
    send(ctx.res, ctx.requestId, 200, {
      id: u.id, hoof: u.hoof, phase: u.phase, size_bytes: u.size_bytes,
      chunk_bytes: u.chunk_bytes, offset: u.uploaded_offset, expires_at: printInstant(u.expires_at)
    });
    return 200;
  }
  if (ctx.method === 'DELETE') {
    const result = await withTx(async tx => {
      const rows = await tx.query(`select * from uploads where id = $1 for update`, [uploadId]);
      if (rows.length === 0) return { notFound: true };
      const u = rows[0];
      const visit = (await tx.query(`select status from visits where id = $1`, [u.visit_id]))[0];
      if (visit.status !== 'open') throw new AppError(409, 'visit_closed');
      await tx.query(`update uploads set ended = true where id = $1`, [uploadId]);
      return { visit_id: u.visit_id };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    await deletePrefix(`uploads/${uploadId}/`).catch(() => {});
    send204(ctx.res, ctx.requestId);
    return 204;
  }
  throw new AppError(404, 'not_found');
}

async function patchUpload(ctx: Ctx, uploadId: string): Promise<number> {
  const c = ctx.caller!;
  await takeAllowance(ctx, 'UPLOAD', c.id);
  const ct = String(ctx.req.headers['content-type'] ?? '');
  if (!ct.startsWith('application/octet-stream')) throw new AppError(415, 'unsupported_media_type');
  const offsetHeader = Number(ctx.req.headers['upload-offset'] ?? NaN);
  const chunk = await readBody(ctx.req, Math.max(config.uploadChunkBytes, 1));

  const session = await withTx(async tx => {
    const rows = await tx.query(`select * from uploads where id = $1 for update`, [uploadId]);
    return rows[0] ?? null;
  });
  if (!session) throw new AppError(404, 'not_found');
  const visitStatus = (await withTx(tx => tx.query(`select status from visits where id = $1`, [session.visit_id])))[0].status;
  if (visitStatus !== 'open') throw new AppError(409, 'visit_closed');
  if (!Number.isFinite(offsetHeader) || offsetHeader !== session.uploaded_offset) {
    throw new AppError(409, 'offset_mismatch', { offset: session.uploaded_offset });
  }
  if (session.expires_at.getTime() <= now().getTime()) throw new AppError(410, 'upload_expired');
  const expectLen = Math.min(config.uploadChunkBytes, session.size_bytes - session.uploaded_offset);
  if (chunk.length !== expectLen && chunk.length !== session.size_bytes - session.uploaded_offset) {
    throw new ValidationError({ chunk: `Send exactly ${config.uploadChunkBytes} bytes, or the rest of the file.` });
  }
  const newOffset = session.uploaded_offset + chunk.length;
  const complete = newOffset >= session.size_bytes;

  // Store the chunk object first.
  try {
    await putObject(`uploads/${uploadId}/${session.uploaded_offset}`, chunk, 'application/octet-stream');
  } catch {
    throw new AppError(503, 'storage_unavailable');
  }

  if (!complete) {
    await withTx(async tx => {
      await tx.query(`update uploads set uploaded_offset = $2 where id = $1`, [uploadId, newOffset]);
    });
    send(ctx.res, ctx.requestId, 200, { offset: newOffset });
    return 200;
  }

  // Assemble the file.
  const parts: Buffer[] = [];
  for (let off = 0; off < session.size_bytes; off += config.uploadChunkBytes) {
    if (off === session.uploaded_offset) { parts.push(chunk); continue; }
    const obj = await getObject(`uploads/${uploadId}/${off}`);
    if (obj === null) throw new AppError(503, 'storage_unavailable');
    parts.push(obj);
  }
  const whole = Buffer.concat(parts);
  const verdict = await storeImage(whole);
  if (!verdict.ok) {
    await deletePrefix(`uploads/${uploadId}/`).catch(() => {});
    await withTx(tx => tx.query(`update uploads set ended = true where id = $1`, [uploadId]));
    throw new AppError(415, 'unsupported_image');
  }
  const result = await withTx(async tx => {
    const v = await lockVisit(tx, session.visit_id);
    if (!v || v.status !== 'open') throw new AppError(409, 'visit_closed');
    const existing = await tx.query(`select 1 from photos where visit_id = $1 and hoof = $2 and phase = $3`, [session.visit_id, session.hoof, session.phase]);
    if (existing.length > 0) throw new AppError(409, 'photo_exists');
    const photoId = newId('pht');
    const key = `visits/${session.visit_id}/${session.hoof}/${session.phase}/${photoId}.${verdict.contentType === 'image/png' ? 'png' : 'jpg'}`;
    await tx.query(`update uploads set ended = true, uploaded_offset = $2 where id = $1`, [uploadId, newOffset]);
    return { photoId, key };
  });
  try {
    await putObject(result.key, verdict.data, verdict.contentType);
  } catch {
    throw new AppError(503, 'storage_unavailable');
  }
  await withTx(async tx => {
    await tx.query(
      `insert into photos(id, visit_id, hoof, phase, content_type, width, height, size_bytes, storage_key, created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [result.photoId, session.visit_id, session.hoof, session.phase, verdict.contentType, verdict.width, verdict.height, verdict.data.length, result.key, now()]
    );
    await enqueueJob(tx, 'thumbnail', now(), { photo_id: result.photoId, key: result.key });
    await audit(tx, actorOf(ctx).audit, 'upload', 'visit', session.visit_id, null, null, ctx.requestId);
  });
  await deletePrefix(`uploads/${uploadId}/`).catch(() => {});
  const photo = await withTx(async tx => {
    const rows = await tx.query(`select * from photos where id = $1`, [result.photoId]);
    return photoJson(tx, rows[0]);
  });
  send(ctx.res, ctx.requestId, 201, photo);
  return 201;
}

// --- Marks (DP-21, DP-22, DP-51, DP-65, DP-101) --------------------------------

/** One place computes angles and the alignment label (Angles). */
export function computeAngles(hw: { x1: number; y1: number; x2: number; y2: number }, pt: { x1: number; y1: number; x2: number; y2: number }): { hoof_wall: number; pastern: number; alignment: 'aligned' | 'broken-back' | 'broken-forward' } {
  const lineAngle = (l: { x1: number; y1: number; x2: number; y2: number }): number => {
    const deg = Math.atan2(Math.abs(l.y2 - l.y1), Math.abs(l.x2 - l.x1)) * 180 / Math.PI;
    const rounded = Math.round(Math.abs(deg) * 10) / 10;
    return deg < 0 ? -rounded : rounded;
  };
  const hwAngle = lineAngle(hw);
  const ptAngle = lineAngle(pt);
  const d = hwAngle - ptAngle;
  const alignment = Math.abs(d) <= 3.0 ? 'aligned' : (d < 0 ? 'broken-back' : 'broken-forward');
  return { hoof_wall: hwAngle, pastern: ptAngle, alignment };
}

function validLine(l: unknown): l is { x1: number; y1: number; x2: number; y2: number } {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
  const o = l as Record<string, unknown>;
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return false;
  }
  return true;
}

async function saveMarks(ctx: Ctx, visitId: string, hoof: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  if (!HOOVES.includes(hoof)) throw new ValidationError({ hoof: 'Enter a number from 1 to 4.' });
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const version = body.version === undefined || body.version === null ? null : (typeof body.version === 'number' ? body.version : null);
  if (!validLine(body.hoof_wall) || !validLine(body.pastern)) {
    throw new ValidationError({ hoof_wall: 'Keep both points inside the photo and apart from each other.' });
  }
  const hw = body.hoof_wall as { x1: number; y1: number; x2: number; y2: number };
  const pt = body.pastern as { x1: number; y1: number; x2: number; y2: number };

  const outcome = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return { notFound: true };
    if (v.status !== 'open') throw new AppError(409, 'visit_closed');
    const photo = (await tx.query(`select * from photos where visit_id = $1 and hoof = $2 and phase = 'after'`, [visitId, hoof]))[0];
    if (!photo) return { photoRequired: true };
    const current = (await tx.query(`select * from marks where visit_id = $1 and hoof = $2 order by version desc limit 1`, [visitId, hoof]))[0] ?? null;
    const currentVersion = current ? current.version : null;
    if (version !== currentVersion) {
      return { stale: current ?? null, currentVersion };
    }
    // Bounds check against the stored upright photo (DP-101).
    const errors: Record<string, string> = {};
    const within = (l: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      l.x1 >= 0 && l.x1 <= photo.width && l.y1 >= 0 && l.y1 <= photo.height &&
      l.x2 >= 0 && l.x2 <= photo.width && l.y2 >= 0 && l.y2 <= photo.height &&
      (l.x1 !== l.x2 || l.y1 !== l.y2);
    if (!within(hw)) errors.hoof_wall = 'Keep both points inside the photo and apart from each other.';
    if (!within(pt)) errors.pastern = 'Keep both points inside the photo and apart from each other.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const angles = computeAngles(hw, pt);
    const newVersion = (currentVersion ?? 0) + 1;
    await tx.query(
      `insert into marks(visit_id, hoof, version, hx1, hy1, hx2, hy2, hoof_wall_angle, px1, py1, px2, py2, pastern_angle, alignment, saved_by, saved_at, restored_from)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,null)`,
      [visitId, hoof, newVersion, hw.x1, hw.y1, hw.x2, hw.y2, angles.hoof_wall,
       pt.x1, pt.y1, pt.x2, pt.y2, angles.pastern, angles.alignment, c.id, now()]
    );
    await audit(tx, actorOf(ctx).audit, 'save_marks', 'visit', visitId, String(currentVersion ?? 0), String(newVersion), ctx.requestId);
    await emitHorseEvent(tx, v.horse_id, 'staff', 'marks_saved', { visit_id: visitId, hoof, version: newVersion });
    const owner = (await tx.query(`select owner_id from horses where id = $1`, [v.horse_id]))[0];
    await emitHorseEvent(tx, v.horse_id, 'owner', 'marks_saved', { visit_id: visitId, hoof, version: newVersion });
    return { saved: (await tx.query(
      `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by where m.visit_id = $1 and m.hoof = $2 and m.version = $3`,
      [visitId, hoof, newVersion]
    ))[0] };
  });
  if (outcome.notFound) throw new AppError(404, 'not_found');
  if (outcome.photoRequired) throw new AppError(409, 'photo_required');
  if (outcome.stale !== undefined) {
    const cur = outcome.stale
      ? marksJson((await withTx(async tx => tx.query(
          `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by where m.visit_id = $1 and m.hoof = $2 and m.version = $3`,
          [visitId, hoof, outcome.stale.version]
        )))[0], true)
      : null;
    throw new (await import('../errors.js')).StaleMarks(cur as never);
  }
  send(ctx.res, ctx.requestId, 200, marksJson(outcome.saved!, true));
  return 200;
}

async function marksHistory(ctx: Ctx, visitId: string, hoof: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  const rows = await withTx(async tx => {
    await lockVisit(tx, visitId);
    return tx.query(
      `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by
       where m.visit_id = $1 and m.hoof = $2 order by m.version`,
      [visitId, hoof]
    );
  });
  send(ctx.res, ctx.requestId, 200, rows.map((m: Row) => marksJson(m, true)));
  return 200;
}

async function restoreMarks(ctx: Ctx, visitId: string, hoof: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'token']);
  const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
  const version = body.version === undefined || body.version === null ? null : (typeof body.version === 'number' ? body.version : null);
  const restoreVersion = typeof body.restore_version === 'number' ? body.restore_version : null;
  const outcome = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return { notFound: true };
    if (v.status !== 'open') throw new AppError(409, 'visit_closed');
    const current = (await tx.query(`select * from marks where visit_id = $1 and hoof = $2 order by version desc limit 1`, [visitId, hoof]))[0] ?? null;
    const currentVersion = current ? current.version : null;
    if (version !== currentVersion) return { stale: current };
    const target = restoreVersion !== null
      ? (await tx.query(`select * from marks where visit_id = $1 and hoof = $2 and version = $3`, [visitId, hoof, restoreVersion]))[0]
      : null;
    if (!target) return { badVersion: true };
    const newVersion = (currentVersion ?? 0) + 1;
    await tx.query(
      `insert into marks(visit_id, hoof, version, hx1, hy1, hx2, hy2, hoof_wall_angle, px1, py1, px2, py2, pastern_angle, alignment, saved_by, saved_at, restored_from)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [visitId, hoof, newVersion,
       target.hx1, target.hy1, target.hx2, target.hy2, target.hoof_wall_angle,
       target.px1, target.py1, target.px2, target.py2, target.pastern_angle,
       target.alignment, c.id, now(), restoreVersion]
    );
    await audit(tx, actorOf(ctx).audit, 'restore_marks', 'visit', visitId, String(currentVersion ?? 0), String(newVersion), ctx.requestId);
    await emitHorseEvent(tx, v.horse_id, 'staff', 'marks_saved', { visit_id: visitId, hoof, version: newVersion });
    await emitHorseEvent(tx, v.horse_id, 'owner', 'marks_saved', { visit_id: visitId, hoof, version: newVersion });
    return { saved: (await tx.query(
      `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by where m.visit_id = $1 and m.hoof = $2 and m.version = $3`,
      [visitId, hoof, newVersion]
    ))[0] };
  });
  if (outcome.notFound) throw new AppError(404, 'not_found');
  if (outcome.badVersion) throw new ValidationError({ restore_version: 'That version is not in this hoof\'s history.' });
  if (outcome.stale !== undefined) {
    const { StaleMarks } = await import('../errors.js');
    const cur = outcome.stale
      ? marksJson((await withTx(async tx => tx.query(
          `select m.*, u.name as saved_by_name, u.role as saved_by_role from marks m join users u on u.id = m.saved_by where m.visit_id = $1 and m.hoof = $2 and m.version = $3`,
          [visitId, hoof, outcome.stale.version]
        )))[0], true)
      : null;
    throw new StaleMarks(cur);
  }
  send(ctx.res, ctx.requestId, 200, marksJson(outcome.saved!, true));
  return 200;
}

// --- Photos ------------------------------------------------------------------

async function photos(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const photoId = ctx.url.pathname.slice('/api/photos/'.length).split('/')[0];
  requireRole(c, ['farrier', 'apprentice', 'owner', 'token']);
  if (ctx.method === 'GET') {
    const out = await withTx(async tx => {
      const p = (await tx.query(`select * from photos where id = $1`, [photoId]))[0];
      if (!p) return null;
      const visit = (await tx.query(`select * from visits where id = $1`, [p.visit_id]))[0];
      if (c.type === 'session' && c.role === 'owner') {
        const horse = (await tx.query(`select owner_id from horses where id = $1`, [visit.horse_id]))[0];
        if (horse.owner_id !== c.id || visit.status === 'open') return null;
      }
      return photoJson(tx, p);
    });
    if (!out) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, out);
    return 200;
  }
  if (ctx.method === 'DELETE') {
    requireRole(c, ['farrier', 'apprentice', 'token']);
    const result = await withTx(async tx => {
      const p = (await tx.query(`select * from photos where id = $1`, [photoId]))[0];
      if (!p) return { notFound: true };
      const visit = await lockVisit(tx, p.visit_id);
      if (!visit || visit.status !== 'open') throw new AppError(409, 'visit_closed');
      await tx.query(`delete from photos where id = $1`, [photoId]);
      if (p.phase === 'after') {
        await tx.query(`delete from marks where visit_id = $1 and hoof = $2`, [p.visit_id, p.hoof]);
        await emitHorseEvent(tx, visit.horse_id, 'staff', 'marks_saved', { visit_id: p.visit_id, hoof: p.hoof, version: null });
        await emitHorseEvent(tx, visit.horse_id, 'owner', 'marks_saved', { visit_id: p.visit_id, hoof: p.hoof, version: null });
      }
      await audit(tx, actorOf(ctx).audit, 'delete_photo', 'visit', p.visit_id, null, null, ctx.requestId);
      return { key: p.storage_key };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    // Remove the objects even while a thumbnail job may be running (DP-97).
    await deleteObject(result.key).catch(() => {});
    await deleteObject(`${result.key}.thumb.jpg`).catch(() => {});
    send204(ctx.res, ctx.requestId);
    return 204;
  }
  throw new AppError(404, 'not_found');
}

// --- Close visit (DP-23, DP-24, DP-25, DP-27, DP-52, DP-70, DP-102) ----------

async function closeVisit(ctx: Ctx, visitId: string): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) throw new AppError(400, 'idempotency_key_required');
  const { parsed: body, raw } = await jsonBody(ctx);
  const claim = await claimIdempotency(c.id, 'visit_close', key, body, raw);
  if (claim.kind === 'replay') {
    send(ctx.res, ctx.requestId, claim.status ?? 200, JSON.parse(claim.body ?? '{}'));
    return claim.status ?? 200;
  }
  if (claim.kind === 'in_progress') throw new AppError(409, 'idempotency_in_progress');
  if (claim.kind === 'conflict') throw new AppError(409, 'idempotency_conflict');

  const work = Array.isArray(body.work) ? body.work.filter((w: unknown): w is string => typeof w === 'string') : [];
  const note = typeof body.note === 'string' ? body.note : '';
  const unique = [...new Set(work)];
  const errors: Record<string, string> = {};
  if (unique.length === 0 || unique.some(w => !SERVICE_CODES.includes(w as never))) {
    errors.work = 'This is required.';
  }
  if (note.length > 500) errors.note = 'This is required.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const prepared = await withTx(async tx => {
    const v = await lockVisit(tx, visitId);
    if (!v) return null;
    if (v.status !== 'open') throw new IllegalTransition(v.status, 'close');
    const after = await tx.query(`select 1 from photos where visit_id = $1 and phase = 'after' limit 1`, [visitId]);
    if (after.length === 0) throw new AppError(409, 'photos_required');
    const booking = (await tx.query(`select * from bookings where id = $1`, [v.booking_id]))[0];
    const day = (await tx.query(`select d.*, br.name as barn_name from barn_days d join barns br on br.id = d.barn_id where d.id = $1`, [booking.barn_day_id]))[0];
    const horse = (await tx.query(`select * from horses where id = $1`, [v.horse_id]))[0];
    const priceList = await priceListFor(tx, String(day.business_date).slice(0, 10));
    const prices: Record<string, number> = priceList ? {
      trim: priceList.trim_price, front_reset: priceList.front_reset, full_reset: priceList.full_reset,
      front_new: priceList.front_new, full_new: priceList.full_new
    } : {};
    const share = booking.trip_share_cents ?? 0;
    const depositLeft = booking.payment_id ? Math.max(0, (await capturedCentsInTx(tx, booking.payment_id)) - (await appliedInTx(tx, booking.payment_id))) : 0;
    const { items, total } = buildInvoiceItems(unique, horse.name, share, day.barn_name, String(day.business_date).slice(0, 10), prices, depositLeft);
    // Close the visit and end its upload sessions.
    const t = now();
    await tx.query(`update visits set status = 'closed', note = $2, closed_at = $3, close_lease_expires_at = $4 where id = $1`, [visitId, note, t, new Date(t.getTime() + config.idempotencyLeaseSeconds * 1000)]);
    const sessions = await tx.query(`select * from uploads where visit_id = $1 and ended = false`, [visitId]);
    await tx.query(`update uploads set ended = true where visit_id = $1 and ended = false`, [visitId]);
    const invoiceId = newId('inv');
    await tx.query(
      `insert into invoices(id, kind, status, horse_id, owner_id, booking_id, visit_id, business_date, items, total_cents, balance_cents, pending_since, created_at)
       values($1,'visit','pending',$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)`,
      [invoiceId, v.horse_id, booking.owner_id, booking.id, visitId, String(day.business_date).slice(0, 10), JSON.stringify(items), total, t, t]
    );
    await tx.query(`update visits set invoice_id = $2 where id = $1`, [visitId, invoiceId]);
    await audit(tx, sessionActor(c.id), 'close', 'visit', visitId, 'open', 'closed', ctx.requestId);
    await audit(tx, sessionActor(c.id), 'create', 'invoice', invoiceId, null, 'pending', ctx.requestId);
    await emitDayEvent(tx, booking.barn_day_id, 'farrier', 'booking_moved', await bookingRowFor(tx, booking.id, 'farrier'));
    await emitHorseEvent(tx, v.horse_id, 'staff', 'visit_closed', { visit_id: visitId });
    await emitHorseEvent(tx, v.horse_id, 'owner', 'visit_closed', { visit_id: visitId });
    return { ok: true as const, invoiceId, items, total, visitId, sessions: sessions.map((s: Row) => s.id), ownerId: booking.owner_id, horseId: v.horse_id, booking, businessDate: String(day.business_date).slice(0, 10) };
  });
  if (prepared === null || !('ok' in prepared)) throw new AppError(404, 'not_found');

  // Remove the ended sessions' chunks within 10 seconds (DP-98).
  for (const sid of prepared.sessions) {
    deletePrefix(`uploads/${sid}/`).catch(() => {});
  }

  // Kill Bill legs, outside the day lock.
  let status: 'invoiced' | 'invoice_pending' = 'invoice_pending';
  try {
    const ownerUser = (await withTx(tx => tx.query(`select * from users where id = $1`, [prepared.ownerId])))[0];
    const accountId = await kb.ensureAccount(ownerUser.email, ownerUser.name);
    const charges = prepared.items!.filter(i => i.amount_cents > 0).map(i => ({ description: `${i.description} [${prepared.invoiceId}]`, amount_cents: i.amount_cents }));
    let kbInvoiceId = await kb.findInvoiceIdByMarker(accountId, `[${prepared.invoiceId}]`);
    if (!kbInvoiceId) {
      const created = await kb.createInvoiceWithCharges(accountId, prepared.businessDate, charges);
      kbInvoiceId = created.invoiceId;
    }
    // Deposit credit: one paired refund and payment, both on this invoice (DP-69).
    const creditItem = prepared.items.find(i => i.amount_cents < 0);
    if (creditItem && prepared.booking.payment_id) {
      const credit = -creditItem.amount_cents;
      await withTx(async tx => {
        await applyDepositCredit(tx, prepared.booking.payment_id, credit, prepared.invoiceId, ctx.requestId);
      });
      const depositIn = await kb.createExternalPayment(kbInvoiceId!, accountId, credit, `${prepared.invoiceId}:deposit-in`, `${prepared.invoiceId}:deposit-in`);
      if (depositIn.paymentId) {
        await kb.transferDepositCreditOut(accountId, kbInvoiceId!, depositIn.paymentId, credit, `${prepared.invoiceId}:deposit-out`).catch(() => {});
      }
    }
    const balance = await kb.getInvoiceBalance(kbInvoiceId!);
    await withTx(async tx => {
      const gross = prepared.items.filter(i => i.amount_cents > 0).reduce((s, i) => s + i.amount_cents, 0);
      await ledgerEntry(tx, 'billed', gross, now(), prepared.ownerId, prepared.horseId, prepared.businessDate, prepared.invoiceId, null);
      const finalBalance = balance?.balance ?? prepared.total;
      const invoiceStatus = finalBalance <= 0 ? 'paid' : 'unpaid';
      await tx.query(`update invoices set killbill_invoice_id = $2, status = $3, balance_cents = $4, pending_since = null where id = $1`, [prepared.invoiceId, kbInvoiceId, invoiceStatus, finalBalance]);
      await tx.query(`update visits set status = 'invoiced' where id = $1`, [prepared.visitId]);
      await audit(tx, systemActor(), 'invoiced', 'invoice', prepared.invoiceId, 'pending', invoiceStatus, ctx.requestId);
    });
    status = 'invoiced';
    // Visit summary email.
    const horse = (await withTx(tx => tx.query(`select name, owner_id from horses where id = $1`, [prepared.horseId])))[0];
    const ownerEmailRow = (await withTx(tx => tx.query(`select email from users where id = $1`, [prepared.ownerId])))[0];
    const nextDue = await withTx(async tx => {
      const h = (await tx.query(`select * from horses where id = $1`, [prepared.horseId]))[0];
      const visits = await tx.query(`select business_date, status from visits where horse_id = $1 order by business_date desc, created_at desc`, [prepared.horseId]);
      const lastWorked = visits.find((vv: Row) => vv.status !== 'open')?.business_date ?? null;
      return nextDueState(lastWorked, h.cycle_weeks).next_due_date;
    });
    const msg = T.visitSummaryEmail(horse.name, prepared.businessDate, prepared.items, prepared.total, nextDue);
    await sendRequestEmail({ to: ownerEmailRow.email, subject: msg.subject, body: msg.body });
    await evaluateOutstanding();
  } catch {
    // stays pending; the reconciler finishes it under Billing outage
  }

  const visit = await withTx(async tx => {
    const v = (await tx.query(`select * from visits where id = $1`, [prepared.visitId!]))[0];
    return visitJson(tx, v, c);
  });
  const responseBody = visit;
  await completeIdempotency(c.id, 'visit_close', key, 200, JSON.stringify(responseBody));
  send(ctx.res, ctx.requestId, 200, responseBody);
  return 200;
}

async function appliedInTx(tx: Tx, paymentId: string): Promise<number> {
  const rows = await tx.query(`select applied_cents from payments where id = $1`, [paymentId]);
  return rows[0]?.applied_cents ?? 0;
}

/** Outstanding balance alert (DP-81): armed per threshold in Postgres. */
async function evaluateOutstanding(): Promise<void> {
  const threshold = config.alertOutstandingCents;
  const state = await withTx(async tx => {
    await tx.query(`insert into alert_state(threshold, armed) values($1, true) on conflict do nothing`, [threshold]);
    const rows = await tx.query(`select armed from alert_state where threshold = $1 for update`, [threshold]);
    const sum = await tx.query(`select coalesce(sum(balance_cents), 0)::int as s from invoices where status = 'unpaid'`);
    return { armed: rows[0].armed, sum: sum[0].s };
  });
  if (state.sum > threshold && state.armed) {
    await withTx(async tx => {
      await tx.query(`update alert_state set armed = false where threshold = $1`, [threshold]);
    });
    const farrier = (await withTx(tx => tx.query(`select email from users where role = 'farrier' order by id limit 1`)))[0];
    const msg = T.outstandingAlertEmail(threshold, state.sum);
    await withTx(tx => queueEmail(tx, { to: farrier.email, subject: msg.subject, body: msg.body }, false));
  } else if (state.sum <= threshold && !state.armed) {
    await withTx(async tx => {
      await tx.query(`update alert_state set armed = true where threshold = $1`, [threshold]);
    });
  }
}

// --- Payments ------------------------------------------------------------------

function paymentJson(p: Row): Record<string, unknown> {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    amount_cents: p.amount_cents,
    captured_cents: p.captured_cents,
    refunded_cents: p.refunded_cents,
    applied_cents: p.applied_cents,
    disposition: p.disposition,
    booking_id: p.booking_id,
    invoice_id: p.invoice_id,
    card_last4: p.card_last4,
    decline_code: p.decline_code,
    killbill_status: p.killbill_status
  };
}

async function payments(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const seg = ctx.url.pathname.slice('/api/payments'.length).split('/').filter(Boolean);
  const paymentId = seg[0];

  if (seg.length === 0 && ctx.method === 'GET') {
    if (c && (c.type === 'token' || c.role === 'farrier')) {
      const rows = await withTx(tx => tx.query(`select * from payments order by created_at desc`));
      send(ctx.res, ctx.requestId, 200, rows.map(paymentJson));
      return 200;
    }
    requireSession(c);
    if (c.role === 'owner') {
      const rows = await withTx(tx => tx.query(`select * from payments where owner_id = $1 order by created_at desc`, [c.id]));
      send(ctx.res, ctx.requestId, 200, rows.map(paymentJson));
      return 200;
    }
    throw new AppError(403, 'forbidden');
  }
  if (seg[1] === 'reconciliation' && ctx.method === 'GET') {
    const f = await requireFarrierSession(ctx);
    const p = (await withTx(tx => tx.query(`select * from payments where id = $1`, [paymentId])))[0];
    if (!p) throw new AppError(404, 'not_found');
    if (p.killbill_status !== 'recorded' || !p.killbill_payment_id) {
      send(ctx.res, ctx.requestId, 200, { status: 'unavailable', app: null, killbill: null, differences: [] });
      return 200;
    }
    const app = {
      total: p.captured_cents,
      paid: p.captured_cents,
      refunded: p.refunded_cents + p.applied_cents,
      balance: Math.max(0, p.captured_cents - p.refunded_cents - p.applied_cents)
    };
    try {
      const kbPayment = await kb.getInvoiceBalance(p.killbill_invoice_id ?? '');
      const killbill = {
        total: app.total,
        paid: app.paid,
        refunded: kbPayment?.refunded ?? 0,
        balance: Math.max(0, app.paid - (kbPayment?.refunded ?? 0))
      };
      const differences: Array<{ field: string; app_cents: number; killbill_cents: number }> = [];
      for (const field of ['total', 'paid', 'refunded', 'balance'] as const) {
        if (app[field] !== killbill[field]) differences.push({ field, app_cents: app[field], killbill_cents: killbill[field] });
      }
      send(ctx.res, ctx.requestId, 200, { status: differences.length > 0 ? 'mismatch' : 'matched', app, killbill, differences });
      return 200;
    } catch {
      send(ctx.res, ctx.requestId, 200, { status: 'unavailable', app, killbill: null, differences: [] });
      return 200;
    }
  }
  if (['capture', 'void', 'refund'].includes(seg[1] ?? '') && ctx.method === 'POST') {
    const f = await requireFarrierSession(ctx);
    const key = ctx.req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) throw new AppError(400, 'idempotency_key_required');
    const { parsed, raw } = await jsonBody(ctx);
    const claim = await claimIdempotency(f.id, `payment_${seg[1]}`, key, parsed, raw);
    if (claim.kind === 'replay') {
      send(ctx.res, ctx.requestId, claim.status ?? 200, JSON.parse(claim.body ?? '{}'));
      return claim.status ?? 200;
    }
    if (claim.kind === 'in_progress') throw new AppError(409, 'idempotency_in_progress');
    if (claim.kind === 'conflict') throw new AppError(409, 'idempotency_conflict');

    const action = seg[1] as 'capture' | 'void' | 'refund';
    const body = parsed;
    const result = await withTx(async tx => {
      const rows = await tx.query(`select * from payments where id = $1 for update`, [paymentId]);
      if (rows.length === 0) return { notFound: true };
      const p = rows[0];
      if (action === 'capture') {
        if (p.status !== 'authorized') throw new IllegalTransition(p.status, 'capture');
        await tx.query(`update payments set status = 'captured', captured_cents = $2, updated_at = $3 where id = $1`, [paymentId, p.amount_cents, now()]);
      } else if (action === 'void') {
        if (p.status !== 'authorized') throw new IllegalTransition(p.status, 'void');
        await tx.query(`update payments set status = 'voided', updated_at = $2 where id = $1`, [paymentId, now()]);
        const hold = (await tx.query(`select * from bookings where payment_id = $1 and status = 'held'`, [paymentId]))[0];
        if (hold) {
          await tx.query(`update bookings set status = 'released', updated_at = $2 where id = $1`, [hold.id, now()]);
        }
      } else {
        const amount = typeof body.amount_cents === 'number' ? body.amount_cents : 0;
        if (!(Number.isInteger(amount) && amount > 0)) throw new ValidationError({ amount_cents: 'Enter an amount in dollars, like 45.00.' });
        const refundable = p.captured_cents - p.refunded_cents - p.applied_cents;
        if (amount > refundable) {
          throw new AppError(409, 'refund_exceeds_captured', { refundable_cents: refundable });
        }
        const newStatus = p.captured_cents <= p.refunded_cents + amount + p.applied_cents ? 'refunded' : 'partially_refunded';
        await tx.query(`update payments set status = $2, refunded_cents = refunded_cents + $3, updated_at = $4 where id = $1`, [paymentId, newStatus, amount, now()]);
      }
      await audit(tx, sessionActor(f.id), action, 'payment', paymentId, null, null, ctx.requestId);
      return { payment: (await tx.query(`select * from payments where id = $1`, [paymentId]))[0] };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    const responseBody = paymentJson(result.payment!);
    await completeIdempotency(f.id, `payment_${seg[1]}`, key, 200, JSON.stringify(responseBody));
    send(ctx.res, ctx.requestId, 200, responseBody);
    return 200;
  }
  if (ctx.method === 'GET' && seg.length === 1) {
    requireSession(c);
    const p = (await withTx(tx => tx.query(`select * from payments where id = $1`, [paymentId])))[0];
    if (!p) throw new AppError(404, 'not_found');
    if (c.role === 'owner' && p.owner_id !== c.id) throw new AppError(404, 'not_found');
    if (c.role === 'apprentice' || c.role === 'barn_manager') throw new AppError(403, 'forbidden');
    send(ctx.res, ctx.requestId, 200, paymentJson(p));
    return 200;
  }
  throw new AppError(404, 'not_found');
}

// --- Invoices (DP-39, DP-55, DP-71) --------------------------------------------

async function invoiceRow(tx: Tx, id: string): Promise<Row | null> {
  const rows = await tx.query(
    `select i.*, h.name as horse_name from invoices i join horses h on h.id = i.horse_id where i.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function invoices(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  const seg = ctx.url.pathname.slice('/api/invoices'.length).split('/').filter(Boolean);
  const invoiceId = seg[0];

  if (ctx.method === 'GET' && seg.length === 0) {
    if (c && (c.type === 'token' || c.role === 'farrier')) {
      const rows = await withTx(async tx => {
        const all = await tx.query(
          `select i.*, h.name as horse_name from invoices i join horses h on h.id = i.horse_id order by i.created_at desc`
        );
        return all;
      });
      send(ctx.res, ctx.requestId, 200, rows.map(invoiceJson));
      return 200;
    }
    requireSession(c);
    if (c.role === 'owner') {
      const rows = await withTx(tx => tx.query(
        `select i.*, h.name as horse_name from invoices i join horses h on h.id = i.horse_id where i.owner_id = $1 order by i.created_at desc`,
        [c.id]
      ));
      send(ctx.res, ctx.requestId, 200, rows.map(invoiceJson));
      return 200;
    }
    throw new AppError(403, 'forbidden');
  }
  if (ctx.method === 'GET' && seg.length === 1) {
    requireRole(c, ['farrier', 'owner']);
    const inv = await withTx(async tx => {
      const i = await invoiceRow(tx, invoiceId);
      if (!i) return null;
      if (c.type === 'session' && c.role === 'owner' && i.owner_id !== c.id) return null;
      return i;
    });
    if (!inv) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, invoiceJson(inv));
    return 200;
  }
  if (seg[1] === 'reconciliation' && ctx.method === 'GET') {
    await requireFarrierSession(ctx);
    const inv = await withTx(tx => invoiceRow(tx, invoiceId));
    if (!inv) throw new AppError(404, 'not_found');
    if (inv.status === 'pending' || !inv.killbill_invoice_id) {
      send(ctx.res, ctx.requestId, 200, { status: 'unavailable', app: null, killbill: null, differences: [] });
      return 200;
    }
    const app = await withTx(async tx => {
      // Paid = the deposit credit applied to this invoice plus card captures (DP-71).
      const depositApplied = await tx.query(
        `select coalesce(sum(applied_cents), 0)::int as s from payments where kind = 'deposit' and booking_id = (select booking_id from invoices where id = $1)`,
        [invoiceId]
      );
      const cardPaid = await tx.query(
        `select coalesce(sum(captured_cents), 0)::int as s from payments where kind = 'invoice' and invoice_id = $1 and status in ('captured','partially_refunded','refunded')`,
        [invoiceId]
      );
      const cardRefunded = await tx.query(
        `select coalesce(sum(refunded_cents), 0)::int as s from payments where kind = 'invoice' and invoice_id = $1`,
        [invoiceId]
      );
      return {
        total: inv.total_cents,
        paid: depositApplied[0].s + cardPaid[0].s,
        refunded: depositApplied[0].s + cardRefunded[0].s,
        balance: inv.balance_cents
      };
    });
    try {
      const ownerUser = (await withTx(tx => tx.query(`select * from users where id = $1`, [inv.owner_id])))[0];
      const accountId = await kb.ensureAccount(ownerUser.email, ownerUser.name);
      const kbInv = await kb.getInvoiceReadback(accountId, inv.killbill_invoice_id, `${invoiceId}:`);
      const killbill = {
        total: kbInv?.total ?? 0,
        paid: kbInv?.paid ?? 0,
        refunded: kbInv?.refunded ?? 0,
        balance: kbInv?.balance ?? 0
      };
      const differences: Array<{ field: string; app_cents: number; killbill_cents: number }> = [];
      for (const field of ['total', 'paid', 'refunded', 'balance'] as const) {
        if (app[field] !== killbill[field]) differences.push({ field, app_cents: app[field], killbill_cents: killbill[field] });
      }
      const status = differences.length > 0 ? 'mismatch' : 'matched';
      await withTx(async tx => {
        if (status === 'mismatch' && inv.reconciliation !== 'mismatch') {
          await tx.query(`update invoices set reconciliation = 'mismatch' where id = $1`, [invoiceId]);
          await audit(tx, systemActor(), 'reconcile', 'invoice', invoiceId, inv.reconciliation, 'mismatch', ctx.requestId);
        } else if (status === 'matched' && inv.reconciliation !== 'matched') {
          await tx.query(`update invoices set reconciliation = 'matched' where id = $1`, [invoiceId]);
        }
      });
      send(ctx.res, ctx.requestId, 200, { status, app, killbill, differences });
      return 200;
    } catch {
      send(ctx.res, ctx.requestId, 200, { status: 'unavailable', app, killbill: null, differences: [] });
      return 200;
    }
  }
  if (seg[1] === 'payments' && ctx.method === 'POST') {
    const owner = requireSession(ctx.caller);
    if (owner.role !== 'owner') throw new AppError(403, 'forbidden');
    await takeAllowance(ctx, 'PAYMENT', owner.id);
    const key = ctx.req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) throw new AppError(400, 'idempotency_key_required');
    const { parsed: body, raw } = await jsonBody(ctx);
    const claim = await claimIdempotency(owner.id, 'invoice_payment', key, body, raw);
    if (claim.kind === 'replay') {
      send(ctx.res, ctx.requestId, claim.status ?? 201, JSON.parse(claim.body ?? '{}'));
      return claim.status ?? 201;
    }
    if (claim.kind === 'in_progress') throw new AppError(409, 'idempotency_in_progress');
    if (claim.kind === 'conflict') throw new AppError(409, 'idempotency_conflict');

    const cardToken = typeof body.card_token === 'string' ? body.card_token : '';
    const errors: Record<string, string> = {};
    if (/\d{12,}/.test(cardToken)) errors.card_token = 'Enter a test card token, never a card number.';
    else if (!CARD_LABELS[cardToken]) errors.card_token = 'Choose one of the test cards.';

    const outcome = await withTx(async tx => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`invoice:${invoiceId}`]);
      const inv = await invoiceRow(tx, invoiceId);
      if (!inv) return { notFound: true };
      if (inv.owner_id !== owner.id) return { notFound: true };
      if (inv.status === 'pending') return { pending: true };
      if (inv.status === 'paid' || inv.balance_cents <= 0) {
        await tx.query(`update invoices set status = 'paid', balance_cents = 0 where id = $1`, [invoiceId]);
        return { alreadyPaid: true };
      }
      if (Object.keys(errors).length > 0) return { badCard: true };
      const outcome2 = cardOutcome(cardToken);
      await tx.query(`update users set card_token = $2, card_last4 = $3 where id = $1`, [owner.id, cardToken, outcome2.last4]);
      if (!outcome2.approved) {
        // A decline writes its row and enters dunning.
        await recordInvoicePaymentDecline(tx, inv, outcome2.declineCode ?? 'unknown_card', outcome2.last4, ctx.requestId);
        return { declined: outcome2.declineCode ?? 'unknown_card' };
      }
      return { ok: true, inv };
    });
    if (outcome.notFound) { await releaseIdempotency(owner.id, 'invoice_payment', key); throw new AppError(404, 'not_found'); }
    if (outcome.pending) { await releaseIdempotency(owner.id, 'invoice_payment', key); throw new AppError(409, 'invoice_pending'); }
    if (outcome.alreadyPaid) {
      const invNow = await withTx(tx => invoiceRow(tx, invoiceId));
      const responseBody = invoiceJson(invNow!);
      await completeIdempotency(owner.id, 'invoice_payment', key, 409, JSON.stringify(responseBody));
      throw new AppError(409, 'already_paid');
    }
    if (outcome.badCard) { await releaseIdempotency(owner.id, 'invoice_payment', key); throw new ValidationError(errors); }
    if (outcome.declined) {
      const inv = await withTx(tx => invoiceRow(tx, invoiceId));
      const responseBody = invoiceJson(inv!);
      await completeIdempotency(owner.id, 'invoice_payment', key, 402, JSON.stringify(responseBody));
      throw new AppError(402, 'card_declined', { decline_code: outcome.declined });
    }

    // Record the payment in Kill Bill first, then capture (DP-39, DP-71).
    const inv = outcome.inv!;
    try {
      const user = (await withTx(tx => tx.query(`select * from users where id = $1`, [owner.id])))[0];
      const accountId = await kb.ensureAccount(user.email, user.name);
      const kbInvoiceId = inv.killbill_invoice_id
        ?? (await kb.findInvoiceIdByMarker(accountId, `[${invoiceId}]`));
      if (!kbInvoiceId) throw new Error('invoice not in killbill');
      const paymentId = await withTx(async tx => {
        const rows = await tx.query(
          `select id from payments where invoice_id = $1 and kind = 'invoice' and status = 'captured' limit 1`,
          [invoiceId]
        );
        if (rows.length > 0) return rows[0].id;
        return null;
      });
      let appPaymentId = paymentId;
      if (!appPaymentId) {
        appPaymentId = await withTx(async tx => recordInvoicePayment(tx, invoiceId, inv.balance_cents, cardToken, cardOutcome(cardToken).last4)
          .then(p => p.id).catch(() => null));
      }
      if (!appPaymentId) throw new Error('payment not recorded');
      const pay = await kb.createExternalPayment(kbInvoiceId, accountId, inv.balance_cents, appPaymentId, `${appPaymentId}:capture`);
      await withTx(async tx => {
        await tx.query(`update payments set killbill_status = 'recorded', pending_since = null, killbill_payment_id = $2 where id = $1`, [appPaymentId, pay.paymentId]);
      });
    } catch {
      // Void: nothing captured, invoice stays unpaid, billing_unavailable.
      await withTx(async tx => {
        await tx.query(
          `update payments set status = 'voided', updated_at = $2 where invoice_id = $1 and kind = 'invoice' and status = 'captured'`,
          [invoiceId, now()]
        );
      });
      const invNow = await withTx(tx => invoiceRow(tx, invoiceId));
      await completeIdempotency(owner.id, 'invoice_payment', key, 503, JSON.stringify({ error: 'billing_unavailable' }));
      throw new AppError(503, 'billing_unavailable');
    }
    // Unblocking: paying the last blocked invoice runs the offer pass (DP-107).
    const wasBlocked = inv.dunning_state === 'blocked';
    const invNow = await withTx(tx => invoiceRow(tx, invoiceId));
    if (wasBlocked && invNow && invNow.dunning_state === 'cleared') {
      await withTx(async tx => {
        const remaining = await tx.query(`select 1 from invoices where owner_id = $1 and dunning_state = 'blocked' limit 1`, [owner.id]);
        if (remaining.length === 0) {
          const days = await tx.query(
            `select w.barn_day_id from waitlist w join barn_days d on d.id = w.barn_day_id
             where w.owner_id = $1 and d.status = 'published' and d.starts_at > $2`,
            [owner.id, now()]
          );
          for (const d of days) {
            await lockDay(tx, d.barn_day_id);
            await offerPass(tx, d.barn_day_id, null);
          }
        }
      });
    }
    await evaluateOutstanding();
    const responseBody = invoiceJson(invNow!);
    await completeIdempotency(owner.id, 'invoice_payment', key, 201, JSON.stringify(responseBody));
    send(ctx.res, ctx.requestId, 201, responseBody);
    return 201;
  }
  throw new AppError(404, 'not_found');
}

async function recordInvoicePaymentDecline(tx: Tx, inv: Row, declineCode: string, last4: string, requestId: string): Promise<void> {
  const paymentId = newId('pay');
  await tx.query(
    `insert into payments(id, kind, status, owner_id, invoice_id, amount_cents, captured_cents, card_last4, decline_code, killbill_status, created_at, updated_at)
     values($1,'invoice','declined',$2,$3,$4,0,$5,$6,'not_recorded',$7,$7)`,
    [paymentId, inv.owner_id, inv.id, inv.balance_cents, last4, declineCode, now()]
  );
  await audit(tx, systemActor(), 'authorise', 'payment', paymentId, null, 'declined', requestId);
  await enterDunning(tx, inv.id, declineCode, requestId);
}

// --- Comparison (DP-32, DP-33) -------------------------------------------------

async function comparison(ctx: Ctx, horseId: string): Promise<number> {
  const c = ctx.caller!;
  requireRole(c, ['farrier', 'apprentice', 'owner']);
  const hoof = ctx.url.searchParams.get('hoof') ?? 'LF';
  if (!HOOVES.includes(hoof)) throw new ValidationError({ hoof: 'Enter a number from 1 to 4.' });
  const body = await withTx(async tx => {
    const horses = await tx.query(`select * from horses where id = $1`, [horseId]);
    if (horses.length === 0) return null;
    if (c.type === 'session' && c.role === 'owner' && horses[0].owner_id !== c.id) return null;
    const isOwner = c.type === 'session' && c.role === 'owner';
    const visits = await tx.query(
      `select distinct v.id, v.business_date from visits v join marks m on m.visit_id = v.id and m.hoof = $1
       where v.horse_id = $2 and v.status <> 'open' order by v.business_date desc, v.id desc`,
      [hoof, horseId]
    );
    if (visits.length < 2) throw new AppError(409, 'not_enough_marked_visits');
    const previousParam = ctx.url.searchParams.get('previous');
    const currentParam = ctx.url.searchParams.get('current');
    let prev: Row | undefined;
    let cur: Row | undefined;
    if (previousParam && currentParam) {
      prev = visits.find(v => v.id === previousParam);
      cur = visits.find(v => v.id === currentParam);
      if (!prev || !cur) throw new AppError(422, 'validation', { errors: { previous: 'This is required.' } });
      if (String(prev.business_date).slice(0, 10) >= String(cur.business_date).slice(0, 10)) {
        throw new AppError(422, 'validation', { errors: { previous: 'This is required.' } });
      }
    } else {
      cur = visits[0];
      prev = visits[1];
    }
    const loadOne = async (v: Row) => {
      const m = (await tx.query(`select * from marks where visit_id = $1 and hoof = $2 order by version desc limit 1`, [v.id, hoof]))[0];
      const p = (await tx.query(`select * from photos where visit_id = $1 and hoof = $2 and phase = 'after'`, [v.id, hoof]))[0];
      return { visit: v, marks: m ?? null, photo: p ?? null };
    };
    const prevOne = await loadOne(prev);
    const curOne = await loadOne(cur);
    if (!prevOne.marks || !curOne.marks) throw new AppError(422, 'validation', { errors: { previous: 'This is required.' } });
    const { comparisonEntry } = await import('./vetview.js');
    const entry = comparisonEntry(prevOne.marks, curOne.marks);
    const prevPhoto = prevOne.photo ? await photoJson(tx, prevOne.photo) : null;
    const curPhoto = curOne.photo ? await photoJson(tx, curOne.photo) : null;
    return {
      horse: { id: horseId, name: horses[0].name },
      hoof,
      previous: { visit_id: prev.id, business_date: String(prev.business_date).slice(0, 10), photo: prevPhoto, ...entry.previous },
      current: { visit_id: cur.id, business_date: String(cur.business_date).slice(0, 10), photo: curPhoto, ...entry.current },
      difference: entry.difference,
      readout: entry.readout,
      marked_visits: visits.map(v => ({ visit_id: v.id, business_date: String(v.business_date).slice(0, 10) }))
    };
  });
  if (body === null) throw new AppError(404, 'not_found');
  send(ctx.res, ctx.requestId, 200, body);
  return 200;
}

// --- Vet links (farrier side) ----------------------------------------------------

async function vetLinksForHorse(ctx: Ctx, horseId: string): Promise<number> {
  const c = ctx.caller!;
  if (!(c && (c.type === 'token' || (c.type === 'session' && c.role === 'farrier')))) throw new AppError(403, 'forbidden');
  const seg = ctx.url.pathname.split('/').filter(Boolean);

  if (ctx.method === 'POST' && seg.length === 4) {
    await requireFarrierSession(ctx);
    const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
    const vetName = typeof body.vet_name === 'string' ? body.vet_name : '';
    const vetEmail = typeof body.vet_email === 'string' ? body.vet_email : '';
    const errors: Record<string, string> = {};
    if (vetName.trim() === '') errors.vet_name = 'This is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vetEmail)) errors.vet_email = 'Enter a valid email address.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    const result = await withTx(async tx => {
      const horse = (await tx.query(`select * from horses where id = $1`, [horseId]))[0];
      if (!horse) return { notFound: true };
      const visits = await tx.query(
        `select id, business_date from visits where horse_id = $1 and status <> 'open' order by business_date desc, created_at desc limit 2`,
        [horseId]
      );
      if (visits.length < 2) return { notEnough: true };
      const token = crypto.randomBytes(24).toString('base64url');
      const id = newId('vet');
      const expiresAt = new Date(now().getTime() + config.vetLinkTtlSeconds * 1000);
      await tx.query(
        `insert into vet_links(id, horse_id, vet_name, vet_email, token_hash, status, expires_at, created_at)
         values($1,$2,$3,$4,$5,'active',$6,$7)`,
        [id, horseId, vetName, vetEmail, tokenHash(token), expiresAt, now()]
      );
      await audit(tx, actorOf(ctx).audit, 'issue', 'vet_link', id, null, 'active', ctx.requestId);
      return { id, token, expiresAt, prev: visits[1].id, cur: visits[0].id };
    });
    if (!result || result.notFound) throw new AppError(404, 'not_found');
    if (result.notEnough) throw new AppError(409, 'not_enough_visits');
    const emailMsg = T.vetLinkEmail(
      (await withTx(tx => tx.query(`select name from horses where id = $1`, [horseId])))[0].name,
      `/vet/${result.token}`,
      result.expiresAt!
    );
    await withTx(tx => queueEmail(tx, { to: vetEmail, subject: emailMsg.subject, body: emailMsg.body }, true));
    send(ctx.res, ctx.requestId, 201, {
      id: result.id,
      url: `/vet/${result.token}`,
      expires_at: printInstant(result.expiresAt!),
      previous_visit_id: result.prev,
      current_visit_id: result.cur
    });
    return 201;
  }
  if (ctx.method === 'GET' && seg.length === 3) {
    const links = await withTx(async tx => {
      const rows = await tx.query(`select * from vet_links where horse_id = $1 order by created_at desc`, [horseId]);
      const out = [];
      for (const l of rows) {
        const pair = await tx.query(
          `select id, business_date from visits where horse_id = $1 and status <> 'open' order by business_date desc, created_at desc limit 2`,
          [horseId]
        );
        const t = now();
        const status = l.status === 'revoked' ? 'revoked' : (l.expires_at.getTime() <= t.getTime() ? 'expired' : 'active');
        const views = await tx.query(`select count(*)::int as n from vet_views where vet_link_id = $1`, [l.id]);
        out.push({
          id: l.id, vet_name: l.vet_name, vet_email: l.vet_email, status,
          expires_at: printInstant(l.expires_at), view_count: views[0].n,
          previous_date: pair.length === 2 ? String(pair[1].business_date).slice(0, 10) : null,
          current_date: pair.length === 2 ? String(pair[0].business_date).slice(0, 10) : null
        });
      }
      return out;
    });
    send(ctx.res, ctx.requestId, 200, links);
    return 200;
  }
  throw new AppError(404, 'not_found');
}

async function vetLinksAdmin(ctx: Ctx): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const seg = ctx.url.pathname.slice('/api/vet-links'.length).split('/').filter(Boolean);
  const linkId = seg[0];

  if (seg[1] === 'revoke' && ctx.method === 'POST') {
    const result = await withTx(async tx => {
      const l = (await tx.query(`select * from vet_links where id = $1 for update`, [linkId]))[0];
      if (!l) return { notFound: true };
      await tx.query(`update vet_links set status = 'revoked' where id = $1`, [linkId]);
      await audit(tx, sessionActor(c.id), 'revoke', 'vet_link', linkId, l.status, 'revoked', ctx.requestId);
      return { l };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, { id: linkId, status: 'revoked' });
    return 200;
  }
  if (seg[1] === 'regenerate' && ctx.method === 'POST') {
    const result = await withTx(async tx => {
      const l = (await tx.query(`select * from vet_links where id = $1 for update`, [linkId]))[0];
      if (!l) return { notFound: true };
      const token = crypto.randomBytes(24).toString('base64url');
      const expiresAt = new Date(now().getTime() + config.vetLinkTtlSeconds * 1000);
      await tx.query(`update vet_links set token_hash = $2, status = 'active', expires_at = $3 where id = $1`, [linkId, tokenHash(token), expiresAt]);
      await audit(tx, sessionActor(c.id), 'regenerate', 'vet_link', linkId, l.status, 'active', ctx.requestId);
      const pair = await tx.query(
        `select id from visits where horse_id = $1 and status <> 'open' order by business_date desc, created_at desc limit 2`,
        [l.horse_id]
      );
      return { token, expiresAt, pair };
    });
    if (!result || result.notFound) throw new AppError(404, 'not_found');
    const link = (await withTx(tx => tx.query(`select * from vet_links where id = $1`, [linkId])))[0];
    const emailMsg = T.vetLinkEmail(
      (await withTx(tx => tx.query(`select name from horses where id = $1`, [link.horse_id])))[0].name,
      `/vet/${result.token}`,
      result.expiresAt!
    );
    await withTx(tx => queueEmail(tx, { to: link.vet_email, subject: emailMsg.subject, body: emailMsg.body }, true));
    send(ctx.res, ctx.requestId, 200, {
      id: linkId,
      url: `/vet/${result.token}`,
      expires_at: printInstant(result.expiresAt!),
      previous_visit_id: result.pair![1]?.id ?? null,
      current_visit_id: result.pair![0]?.id ?? null
    });
    return 200;
  }
  if (seg[1] === 'views' && ctx.method === 'GET') {
    const rows = await withTx(async tx => {
      const views = await tx.query(`select * from vet_views where vet_link_id = $1 order by at desc`, [linkId]);
      return views.map((v: Row) => ({
        at: printInstant(v.at), address: v.address, outcome: v.outcome, user_agent: v.user_agent,
        previous_date: v.outcome === 'viewed' && v.previous_date ? String(v.previous_date).slice(0, 10) : null,
        current_date: v.outcome === 'viewed' && v.pair_current_date ? String(v.pair_current_date).slice(0, 10) : null
      }));
    });
    send(ctx.res, ctx.requestId, 200, rows);
    return 200;
  }
  throw new AppError(404, 'not_found');
}

// --- Price lists (DP-02) ----------------------------------------------------------

async function priceLists(ctx: Ctx): Promise<number> {
  const c = ctx.caller!;
  if (!(c && (c.type === 'token' || (c.type === 'session' && c.role === 'farrier')))) throw new AppError(403, 'forbidden');
  const seg = ctx.url.pathname.slice('/api/price-lists'.length).split('/').filter(Boolean);

  if (ctx.method === 'GET' && seg.length === 0) {
    const rows = await withTx(tx => tx.query(`select * from price_lists order by effective_from desc`));
    send(ctx.res, ctx.requestId, 200, rows.map((p: Row) => ({
      id: p.id,
      effective_from: String(p.effective_from).slice(0, 10),
      deposit_cents: p.deposit_cents,
      prices: { trim: p.trim_price, front_reset: p.front_reset, full_reset: p.full_reset, front_new: p.front_new, full_new: p.full_new }
    })));
    return 200;
  }
  if (ctx.method === 'POST' && seg.length === 0) {
    await requireFarrierSession(ctx);
    const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
    const effectiveFrom = typeof body.effective_from === 'string' ? body.effective_from : '';
    const errors: Record<string, string> = {};
    if (!validDate(effectiveFrom)) errors.effective_from = 'This is required.';
    const pricesIn = (body.prices ?? {}) as Record<string, unknown>;
    const prices: Record<string, number> = {};
    for (const code of SERVICE_CODES) {
      const v = pricesIn[code];
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        errors[code] = 'Enter an amount in dollars, like 45.00.';
      } else {
        prices[code] = v;
      }
    }
    const deposit = typeof body.deposit_cents === 'number' ? body.deposit_cents : NaN;
    if (!(Number.isInteger(deposit) && deposit >= 0 && deposit <= 100000)) errors.deposit_cents = 'Enter an amount in dollars, like 45.00.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const existing = await withTx(tx => tx.query(`select 1 from price_lists where effective_from = $1`, [effectiveFrom]));
    if (existing.length > 0) throw new AppError(409, 'price_list_exists');
    const id = newId('prc');
    await withTx(async tx => {
      await tx.query(
        `insert into price_lists(id, effective_from, deposit_cents, trim_price, front_reset, full_reset, front_new, full_new, created_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, effectiveFrom, deposit, prices.trim, prices.front_reset, prices.full_reset, prices.front_new, prices.full_new, now()]
      );
      await audit(tx, sessionActor(c.id), 'create', 'price_list', id, null, null, ctx.requestId);
    });
    send(ctx.res, ctx.requestId, 201, {
      id,
      effective_from: effectiveFrom,
      deposit_cents: deposit,
      prices: { trim: prices.trim, front_reset: prices.front_reset, full_reset: prices.full_reset, front_new: prices.front_new, full_new: prices.full_new }
    });
    return 201;
  }
  throw new AppError(404, 'not_found');
}

// --- API tokens (DP-82) -------------------------------------------------------------

async function tokensRoutes(ctx: Ctx): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const seg = ctx.url.pathname.slice('/api/tokens'.length).split('/').filter(Boolean);

  if (ctx.method === 'POST' && seg.length === 0) {
    const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const scope = body.scope === 'billing' ? 'billing' : body.scope === 'read_only' ? 'read_only' : '';
    const errors: Record<string, string> = {};
    if (name.length < 1 || name.length > 80) errors.name = 'This is required.';
    if (scope === '') errors.scope = 'This is required.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const id = newId('tok');
    const plaintext = newTokenPlaintext();
    await withTx(async tx => {
      await tx.query(
        `insert into tokens(id, name, scope, token_hash, created_at) values($1,$2,$3,$4,$5)`,
        [id, name, scope, tokenHash(plaintext), now()]
      );
      await audit(tx, sessionActor(c.id), 'create', 'api_token', id, null, scope, ctx.requestId);
    });
    send(ctx.res, ctx.requestId, 201, { id, name, scope, token: plaintext, created_at: printInstant(now()) });
    return 201;
  }
  if (ctx.method === 'GET' && seg.length === 0) {
    const rows = await withTx(tx => tx.query(`select * from tokens where revoked_at is null order by created_at desc`));
    send(ctx.res, ctx.requestId, 200, rows.map((t: Row) => ({ id: t.id, name: t.name, scope: t.scope, created_at: printInstant(t.created_at) })));
    return 200;
  }
  if (ctx.method === 'DELETE' && seg.length === 1) {
    const result = await withTx(async tx => {
      const rows = await tx.query(`select * from tokens where id = $1 and revoked_at is null`, [seg[0]]);
      if (rows.length === 0) return { notFound: true };
      await tx.query(`update tokens set revoked_at = $2 where id = $1`, [seg[0], now()]);
      await audit(tx, sessionActor(c.id), 'revoke', 'api_token', seg[0], null, null, ctx.requestId);
      return { ok: true };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    send204(ctx.res, ctx.requestId);
    return 204;
  }
  throw new AppError(404, 'not_found');
}

// --- Jobs (farrier) ------------------------------------------------------------------

async function jobJson(j: Row): Promise<Record<string, unknown>> {
  let result: unknown = null;
  try { result = j.result ? JSON.parse(j.result) : null; } catch { result = null; }
  if (j.kind === 'due_reminder' && !result) {
    try { result = JSON.parse(j.params); } catch { result = null; }
  }
  return {
    id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, max_attempts: j.max_attempts,
    run_at: printInstant(j.run_at), last_error: j.last_error, result
  };
}

async function jobsRoutes(ctx: Ctx): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const seg = ctx.url.pathname.slice('/api/jobs'.length).split('/').filter(Boolean);

  if (ctx.method === 'GET' && seg.length === 1) {
    const j = (await withTx(tx => tx.query(`select * from jobs where id = $1`, [seg[0]])))[0];
    if (!j) throw new AppError(404, 'not_found');
    send(ctx.res, ctx.requestId, 200, jobJson(j));
    return 200;
  }
  if (ctx.method === 'GET' && seg.length === 0) {
    const status = ctx.url.searchParams.get('status');
    const kind = ctx.url.searchParams.get('kind');
    let sql = `select * from jobs`;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    if (kind) { params.push(kind); conds.push(`kind = $${params.length}`); }
    if (conds.length > 0) sql += ' where ' + conds.join(' and ');
    sql += ' order by created_at desc limit 200';
    const rows = await withTx(tx => tx.query(sql, params));
    send(ctx.res, ctx.requestId, 200, rows.map(jobJson));
    return 200;
  }
  if (ctx.method === 'POST' && seg[1] === 'retry') {
    const result = await withTx(async tx => {
      const j = (await tx.query(`select * from jobs where id = $1 for update`, [seg[0]]))[0];
      if (!j) return { notFound: true };
      if (j.status !== 'dead') throw new IllegalTransition(j.status, 'retry');
      await tx.query(`update jobs set status = 'queued', attempts = 0, run_at = $2, last_error = null where id = $1`, [seg[0], now()]);
      await audit(tx, sessionActor(c.id), 'retry', 'job' as never, seg[0], 'dead', 'queued', ctx.requestId);
      return { ok: true };
    });
    if (result.notFound) throw new AppError(404, 'not_found');
    const j = (await withTx(tx => tx.query(`select * from jobs where id = $1`, [seg[0]])))[0];
    send(ctx.res, ctx.requestId, 200, jobJson(j));
    return 200;
  }
  throw new AppError(404, 'not_found');
}

// --- Audit ------------------------------------------------------------------------------

async function auditRoute(ctx: Ctx): Promise<number> {
  await requireFarrierSession(ctx);
  const entityType = ctx.url.searchParams.get('entity_type');
  const entityId = ctx.url.searchParams.get('entity_id');
  const limitStr = ctx.url.searchParams.get('limit') ?? '100';
  const limit = Number(limitStr);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 500)) throw new ValidationError({ limit: 'Enter a number from 1 to 500.' });
  const rows = await withTx(async tx => {
    let sql = `select * from audit_log`;
    const conds: string[] = [];
    const params: unknown[] = [];
    if (entityType) { params.push(entityType); conds.push(`entity_type = $${params.length}`); }
    if (entityId) { params.push(entityId); conds.push(`entity_id = $${params.length}`); }
    if (conds.length > 0) sql += ' where ' + conds.join(' and ');
    sql += ' order by id desc limit ' + limit;
    return tx.query(sql, params);
  });
  send(ctx.res, ctx.requestId, 200, rows.map((a: Row) => ({
    id: String(a.id), at: printInstant(a.at),
    actor: { type: a.actor_type, id: a.actor_id },
    action: a.action, entity_type: a.entity_type, entity_id: a.entity_id,
    from: a.from_status, to: a.to_status, request_id: a.request_id
  })));
  return 200;
}

// --- Dashboard (DP-79) -------------------------------------------------------------------

async function dashboard(ctx: Ctx): Promise<number> {
  await requireFarrierSession(ctx);
  const seg = ctx.url.pathname.slice('/api/dashboard'.length).split('/').filter(Boolean);

  if (ctx.method === 'GET' && seg.length === 0) {
    const monthParam = ctx.url.searchParams.get('month');
    const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;
    if (monthParam && !month) throw new ValidationError({ month: 'This is required.' });
    const target = month ?? todayInPractice().slice(0, 7);
    const body = await withTx(async tx => {
      const entries = await tx.query(
        `select kind, amount_cents, at from ledger where to_char(at, 'YYYY-MM') = $1`,
        [target]
      );
      const daily = new Map<string, { billed: number; collected: number; refunded: number }>();
      let billed = 0, collected = 0, refunded = 0;
      for (const e of entries) {
        const date = businessDate(practiceZoneName(), e.at);
        if (!daily.has(date)) daily.set(date, { billed: 0, collected: 0, refunded: 0 });
        const d = daily.get(date)!;
        switch (e.kind) {
          case 'billed': billed += e.amount_cents; d.billed += e.amount_cents; break;
          case 'deposit_captured': collected += e.amount_cents; d.collected += e.amount_cents; break;
          case 'invoice_payment': collected += e.amount_cents; d.collected += e.amount_cents; break;
          case 'refund': refunded += e.amount_cents; d.refunded += e.amount_cents; break;
          default: break;
        }
      }
      const outstandingRows = await tx.query(
        `select coalesce(sum(balance_cents), 0)::int as s from invoices where status = 'unpaid' and to_char(business_date, 'YYYY-MM') = $1`,
        [target]
      );
      // Overdue horses whose next due date falls in this month.
      const horses = await tx.query(`select id, cycle_weeks from horses`);
      const lastVisits = await tx.query(
        `select distinct on (horse_id) horse_id, business_date from visits where status <> 'open' order by horse_id, business_date desc`
      );
      const lastByHorse = new Map<string, string>();
      for (const v of lastVisits) lastByHorse.set(v.horse_id, String(v.business_date).slice(0, 10));
      let overdueHorses = 0;
      const today = todayInPractice();
      for (const h of horses) {
        const lw = lastByHorse.get(h.id);
        if (!lw) continue;
        const due = nextDueState(lw, h.cycle_weeks);
        if (due.due_status === 'overdue' && due.next_due_date && due.next_due_date.slice(0, 7) === target) overdueHorses++;
      }
      const dates = [...daily.keys()].sort();
      return {
        month: target,
        billed_cents: billed,
        collected_cents: collected,
        refunded_cents: refunded,
        outstanding_cents: outstandingRows[0].s,
        overdue_horses: overdueHorses,
        rows: dates.map(d => ({ date: d, billed_cents: daily.get(d)!.billed, collected_cents: daily.get(d)!.collected, refunded_cents: daily.get(d)!.refunded }))
      };
    });
    send(ctx.res, ctx.requestId, 200, body);
    return 200;
  }
  if (ctx.method === 'POST' && seg[0] === 'exports') {
    await requireFarrierSession(ctx);
    const { parsed: body, raw: bodyRaw } = await jsonBody(ctx);
    const month = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : todayInPractice().slice(0, 7);
    const jobId = await withTx(async tx => enqueueJob(tx, 'csv_export', now(), { month }));
    send(ctx.res, ctx.requestId, 202, { job_id: jobId });
    return 202;
  }
  throw new AppError(404, 'not_found');
}

// --- Import (DP-56, DP-57) -------------------------------------------------------------------

async function importCsv(ctx: Ctx): Promise<number> {
  const c = await requireFarrierSession(ctx);
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) throw new AppError(400, 'idempotency_key_required');
  const ct = String(ctx.req.headers['content-type'] ?? '');
  if (!ct.startsWith('text/csv')) throw new AppError(415, 'unsupported_media_type');
  const raw = await readBody(ctx.req, IMPORT_LIMIT);
  const claim = await claimIdempotency(c.id, 'import', key, null, raw);
  if (claim.kind === 'replay') {
    send(ctx.res, ctx.requestId, claim.status ?? 201, JSON.parse(claim.body ?? '{}'));
    return claim.status ?? 201;
  }
  if (claim.kind === 'in_progress') throw new AppError(409, 'idempotency_in_progress');
  if (claim.kind === 'conflict') throw new AppError(409, 'idempotency_conflict');

  const parse = parseCsv(raw);
  const importId = newId('imp');
  const failImport = async (errors: Array<{ line: number; column: string; code: string }>): Promise<never> => {
    await completeIdempotency(c.id, 'import', key, 422, JSON.stringify(new (await import('../errors.js')).ImportInvalidError(errors).body()));
    throw new (await import('../errors.js')).ImportInvalidError(errors);
  };
  const result = await withTx(async tx => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, ['import']);
    if (parse.errors.length > 0) {
      return { refused: parse.errors };
    }
    const errors = await validateImport(tx.query.bind(tx), parse.rows);
    if (errors.length > 0) {
      return { refused: errors };
    }
    let createdOwners = 0, matchedOwners = 0, createdHorses = 0, updatedHorses = 0;
    const stallChanges: Array<{ horseId: string; oldStall: string }> = [];
    for (const r of parse.rows) {
      const email = r.owner_email.toLowerCase();
      let owner = (await tx.query(`select * from users where lower(email) = $1`, [email]))[0];
      if (!owner) {
        const oid = newId('usr');
        const hash = await bcrypt.hash(config.importDefaultPassword, 10);
        await tx.query(
          `insert into users(id, name, email, password_hash, role, phone, created_at) values($1,$2,$3,$4,'owner',$5,$6)`,
          [oid, r.owner_name, r.owner_email, hash, r.owner_phone, now()]
        );
        owner = (await tx.query(`select * from users where id = $1`, [oid]))[0];
        createdOwners++;
      } else {
        matchedOwners++;
      }
      const barn = (await tx.query(`select * from barns where lower(name) = lower($1)`, [r.barn_name]))[0];
      const existing = (await tx.query(
        `select * from horses where owner_id = $1 and lower(name) = lower($2)`,
        [owner.id, r.horse_name]
      ))[0];
      if (existing) {
        if (existing.stall !== r.stall) {
          stallChanges.push({ horseId: existing.id, oldStall: existing.stall });
        }
        if (existing.barn_id !== barn.id || existing.stall !== r.stall || existing.cycle_weeks !== Number(r.cycle_weeks)) {
          await tx.query(`update horses set barn_id = $2, stall = $3, cycle_weeks = $4 where id = $1`,
            [existing.id, barn.id, r.stall, Number(r.cycle_weeks)]);
          updatedHorses++;
        }
      } else {
        const hid = newId('hrs');
        await tx.query(
          `insert into horses(id, name, owner_id, barn_id, stall, cycle_weeks, created_at) values($1,$2,$3,$4,$5,$6,$7)`,
          [hid, r.horse_name, owner.id, barn.id, r.stall, Number(r.cycle_weeks), now()]
        );
        createdHorses++;
      }
    }
    await audit(tx, sessionActor(c.id), 'import', 'import', importId, null, null, ctx.requestId);
    // Stall changes reach open barn day streams (DP-106).
    for (const change of stallChanges) {
      const bookingDays = await tx.query(
        `select distinct b.barn_day_id from bookings b where b.horse_id = $1 and b.status in ('confirmed','worked','no_show')`,
        [change.horseId]
      );
      for (const d of bookingDays) {
        const day = await loadDay(tx, d.barn_day_id);
        if (!day || !['published', 'in_progress'].includes(day.status)) continue;
        for (const role of ['farrier', 'apprentice', 'barn_manager'] as const) {
          const rows = await tx.query(
            `select b.id from bookings b where b.horse_id = $1 and b.barn_day_id = $2 and b.status in ('confirmed','worked','no_show') limit 1`,
            [change.horseId, d.barn_day_id]
          );
          if (rows.length > 0) {
            await emitDayEvent(tx, d.barn_day_id, role, 'booking_moved', await bookingRowFor(tx, rows[0].id, role));
          }
        }
      }
    }
    return { createdOwners, matchedOwners, createdHorses, updatedHorses };
  });
  if ('refused' in result && result.refused) {
    await failImport(result.refused as Array<{ line: number; column: string; code: string }>);
  }
  const responseBody = {
    id: importId,
    created_owners: result.createdOwners,
    matched_owners: result.matchedOwners,
    created_horses: result.createdHorses,
    updated_horses: result.updatedHorses,
    rows: parse.rows.length
  };
  await completeIdempotency(c.id, 'import', key, 201, JSON.stringify(responseBody));
  send(ctx.res, ctx.requestId, 201, responseBody);
  return 201;
}
