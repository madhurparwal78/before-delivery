import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, withTx, hashPassword, verifyPassword } from './db.js';
import { createBooking, validateEmail, validatePhone, FIELD_MESSAGES, type BookingInput } from './booking.js';
import { cancelPassengers, cancellationQuote, loadBooking, loadPassengers, type CancelFailure, type BookingRow } from './cancel.js';
import { storeTicket } from './tickets.js';
import { labelFor } from './labels.js';
import {
  TRAINS, STATIONS, runContext, stationName, advanceOpening, tatkalOpening, wlTypeForStop,
} from '../seed.js';
import { ClassCode, QuotaCode, AcceptCode, BerthPref, Gender } from '../types.js';
import { nowMs, istStamp, istDate, istLabelDate, istHHMM, parseIstDate, clockRate } from '../time.js';
import { farePaise, fareBeforeGstPaise, gstOnFarePaise } from '../fare.js';
import { availCounts, loadInventory, stretchesOverlap, type RunInventory } from './inventory.js';
import { berthQuota, berthType, BERTHS_PER_COACH } from '../berth.js';
import { getTicket, StorageDown, ticketKey } from './minio.js';

// The API. One error shape is produced in one place and used by every endpoint.

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: unknown;
  rawBody?: Buffer;
  sessionId?: string;
  accountId?: string;
  idempotencyKey?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function err(status: number, code: string, message: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(status, code, message, extra);
}

function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', 'Check these fields', { errors });
}

export interface AccountRow { id: string; name: string; email: string; phone: string }

export async function ctxAccount(ctx: Ctx): Promise<AccountRow> {
  if (!ctx.accountId) throw err(401, 'unauthenticated', 'Sign in to continue.');
  const c = await pool.connect();
  try {
    const r = await c.query<AccountRow>(
      'SELECT a.id, a.name, a.email, a.phone FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE s.id = $1',
      [ctx.sessionId],
    );
    const a = r.rows[0];
    if (!a) throw err(401, 'unauthenticated', 'Sign in to continue.');
    return a;
  } finally {
    c.release();
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function requireTrain(number: string) {
  const t = TRAINS.find((x) => x.number === number);
  if (!t) throw err(404, 'not_found', 'No train has this number.');
  return t;
}

// ---------- accounts and sessions ----------

export async function createAccount(ctx: Ctx): Promise<{ status: number; body: unknown; sessionId: string }> {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const name = str(b.name).trim();
  const email = str(b.email).trim().toLowerCase();
  const password = str(b.password);
  const phone = str(b.phone).trim();
  if (name.length < 1 || name.length > 80) errors['name'] = FIELD_MESSAGES.name;
  if (!validateEmail(email)) errors['email'] = FIELD_MESSAGES.email;
  if (password.length < 10) errors['password'] = FIELD_MESSAGES.password;
  if (!validatePhone(phone)) errors['phone'] = FIELD_MESSAGES.phone;
  if (Object.keys(errors).length > 0) throw validation(errors);

  const existing = await pool.query('SELECT 1 FROM accounts WHERE email = $1', [email]);
  if ((existing.rowCount ?? 0) > 0) throw err(409, 'email_taken', 'An account already uses this email.');

  const id = randomUUID();
  const sid = randomUUID();
  await withTx(async (c) => {
    await c.query(
      'INSERT INTO accounts (id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [id, name, email, phone, hashPassword(password)],
    );
    await c.query('INSERT INTO sessions (id, account_id) VALUES ($1,$2)', [sid, id]);
  });
  return { status: 201, body: { id, name, email, phone }, sessionId: sid };
}

export async function signIn(ctx: Ctx): Promise<{ status: number; body: unknown; sessionId: string }> {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const email = str(b.email).trim().toLowerCase();
  const password = str(b.password);
  const r = await pool.query<{ id: string; name: string; email: string; phone: string; password_hash: string }>(
    'SELECT id, name, email, phone, password_hash FROM accounts WHERE email = $1', [email],
  );
  const row = r.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw err(401, 'invalid_credentials', 'Email or password is wrong.');
  }
  const sid = randomUUID();
  await pool.query('INSERT INTO sessions (id, account_id) VALUES ($1,$2)', [sid, row.id]);
  return {
    status: 200,
    body: { id: row.id, name: row.name, email: row.email, phone: row.phone },
    sessionId: sid,
  };
}

export async function signOut(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  if (ctx.sessionId) await pool.query('DELETE FROM sessions WHERE id = $1', [ctx.sessionId]);
  return { status: 204, body: null };
}

export async function me(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const a = await ctxAccount(ctx);
  return { status: 200, body: { id: a.id, name: a.name, email: a.email, phone: a.phone } };
}

// ---------- stations, clock ----------

export async function stations(): Promise<unknown> {
  return { stations: STATIONS };
}

export async function clock(): Promise<unknown> {
  return { now: istStamp(nowMs()), zone: 'Asia/Kolkata', rate: clockRate() };
}

// ---------- trains ----------

export async function searchTrains(ctx: Ctx): Promise<unknown> {
  const q = ctx.query;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const date = q.get('date') ?? '';
  const quotaRaw = q.get('quota') ?? 'GN';
  const classRaw = q.get('class');
  if (!STATIONS.some((s) => s.code === from)) throw err(404, 'not_found', 'No station has this code.');
  if (!STATIONS.some((s) => s.code === to)) throw err(404, 'not_found', 'No station has this code.');
  const errors: Record<string, string> = {};
  if (from === to) errors['to'] = FIELD_MESSAGES.to;
  const runDateMs = parseIstDate(date);
  if (runDateMs === null) errors['date'] = FIELD_MESSAGES.date;
  const quota = quotaRaw as QuotaCode;
  if (!['GN', 'TQ', 'LD', 'SS'].includes(quota)) errors['quota'] = FIELD_MESSAGES.quota;
  let cls: ClassCode | null = null;
  if (classRaw !== null) {
    if (classRaw !== 'SL' && classRaw !== '3A') errors['class'] = FIELD_MESSAGES.class;
    else cls = classRaw;
  }
  if (Object.keys(errors).length > 0) throw validation(errors);

  const now = nowMs();
  const c = await pool.connect();
  try {
    const results: { depMs: number; train: unknown }[] = [];
    for (const train of TRAINS) {
      if (cls && !train.coaches.some((x) => x.cls === cls)) continue;
      const rc = runContext(train.number, runDateMs!);
      const fromIdx = rc!.stops.findIndex((s) => s.code === from);
      const toIdx = rc!.stops.findIndex((s) => s.code === to);
      if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) continue;
      const classList = cls ? [cls] : (['SL', '3A'] as ClassCode[]).filter((k) => train.coaches.some((x) => x.cls === k));
      const classes = [];
      for (const k of classList) {
        const inv = await loadInventory(c, rc!, k);
        classes.push(classEntry(c, inv, rc!, k, quota, fromIdx, toIdx, now));
      }
      results.push({
        depMs: rc!.stops[fromIdx].depMs,
        train: {
          number: train.number,
          name: train.name,
          run_date: istDate(rc!.runDateMs),
          from: { code: from, name: stationName(from), departure_at: istStamp(rc!.stops[fromIdx].depMs) },
          to: { code: to, name: stationName(to), arrival_at: istStamp(rc!.stops[toIdx].depMs) },
          stops: rc!.stops.map((s) => ({ code: s.code, name: s.name, km: s.km, departure_at: istStamp(s.depMs) })),
          chart_at: istStamp(rc!.chartMs),
          chart_prepared: now >= rc!.chartMs,
          classes,
        },
      });
    }
    results.sort((a, b) => a.depMs - b.depMs);
    return { trains: results.map((r) => r.train) };
  } finally {
    c.release();
  }
}

function classEntry(
  _c: PoolClient, inv: RunInventory,
  rc: NonNullable<ReturnType<typeof runContext>>, cls: ClassCode, quota: QuotaCode,
  fromIdx: number, toIdx: number, now: number,
): Record<string, unknown> {
  const counts = availCounts(inv, rc, cls, quota, fromIdx, toIdx);
  const chartPrepared = now >= rc.chartMs;
  const opensAt = quota === 'TQ' ? tatkalOpening(rc.runDateMs, cls) : advanceOpening(rc.runDateMs);
  const window = chartPrepared ? 'chart_prepared' : (now >= opensAt ? 'open' : 'not_yet_open');
  const km = rc.stops[toIdx].km - rc.stops[fromIdx].km;
  const adultFare = farePaise(km, cls, quota === 'TQ');

  let label: string;
  if (chartPrepared) label = 'CHART PREPARED';
  else if (quota === 'TQ' && now < opensAt) label = `TATKAL OPENS ${istLabelDate(opensAt)} ${istHHMM(opensAt)} IST`;
  else if (quota !== 'TQ' && now < opensAt) label = `OPENS ${istLabelDate(opensAt)}`;
  else if (quota === 'GN') {
    const wlType = wlTypeForStop(rc.train, rc.stops[fromIdx].code);
    const regret = counts.wl >= counts.wlCap;
    label = `AVL ${counts.avl} / RAC ${counts.rac} / ${regret ? 'REGRET' : `${wlType} ${counts.wl}`}`;
  } else if (quota === 'TQ') {
    const regret = counts.wl >= counts.wlCap;
    label = `AVL ${counts.avl} / ${regret ? 'REGRET' : `TQWL ${counts.wl}`}`;
  } else {
    label = counts.avl > 0 ? `AVL ${counts.avl}` : 'NOT AVAILABLE';
  }

  return {
    class: cls,
    quota,
    window,
    opens_at: istStamp(opensAt),
    avl: counts.avl,
    rac: quota === 'GN' ? counts.rac : null,
    wl_type: quota === 'GN' || quota === 'TQ'
      ? (quota === 'TQ' ? 'TQWL' : wlTypeForStop(rc.train, rc.stops[fromIdx].code))
      : null,
    wl: quota === 'GN' || quota === 'TQ' ? counts.wl : null,
    wl_cap: quota === 'GN' || quota === 'TQ' ? counts.wlCap : null,
    label,
    adult_fare_paise: adultFare,
  };
}

export async function coaches(ctx: Ctx): Promise<unknown> {
  const parts = ctx.path.split('/');
  const train = requireTrain(parts[3] ?? '');
  const runDate = parts[5] ?? '';
  const cls = (ctx.query.get('class') ?? '') as ClassCode;
  const from = ctx.query.get('from') ?? '';
  const to = ctx.query.get('to') ?? '';
  if (cls !== 'SL' && cls !== '3A') throw validation({ class: FIELD_MESSAGES.class });
  const runDateMs = parseIstDate(runDate);
  if (runDateMs === null) throw validation({ run_date: FIELD_MESSAGES.date });
  const rc = runContext(train.number, runDateMs);
  if (!rc) throw err(404, 'not_found', 'No train has this number.');
  const fromIdx = rc.stops.findIndex((s) => s.code === from);
  const toIdx = rc.stops.findIndex((s) => s.code === to);
  if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) throw err(404, 'not_found', 'No train has this number.');

  const c = await pool.connect();
  try {
    const inv = await loadInventory(c, rc, cls);
    const coachCodes = rc.train.coaches.filter((x) => x.cls === cls).map((x) => x.code);
    const out = coachCodes.map((coach) => ({
      coach,
      berths: Array.from({ length: BERTHS_PER_COACH }, (_, i) => {
        const berth = i + 1;
        const quota = berthQuota(berth);
        let state: string;
        if (quota === 'RAC') {
          const p1 = placeOccupied(inv, coach, berth, 1, fromIdx, toIdx);
          const p2 = placeOccupied(inv, coach, berth, 2, fromIdx, toIdx);
          state = p1 && p2 ? 'rac_full' : (p1 || p2 ? 'rac_one_free' : 'rac_free');
        } else {
          const taken = inv.holds.some((h) =>
            h.coach === coach && h.berth === berth && h.place === 0
            && stretchesOverlap(h.from_idx, h.to_idx, fromIdx, toIdx));
          state = taken ? 'taken' : 'free';
        }
        return { berth, bay: Math.ceil(berth / 8), type: berthType(berth), quota, state };
      }),
    }));
    return { coaches: out };
  } finally {
    c.release();
  }
}

function placeOccupied(inv: RunInventory, coach: string, berth: number, place: number, from: number, to: number): boolean {
  return inv.holds.some((h) =>
    h.coach === coach && h.berth === berth && h.place === place
    && stretchesOverlap(h.from_idx, h.to_idx, from, to));
}

// ---------- fare quote ----------

export async function fareQuote(ctx: Ctx): Promise<unknown> {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const trainNo = str(b.train);
  const train = requireTrain(trainNo);
  const runDate = str(b.run_date);
  const from = str(b.from);
  const to = str(b.to);
  const cls = str(b.class) as ClassCode;
  const quota = (str(b.quota) || 'GN') as QuotaCode;
  const passengers = Array.isArray(b.passengers) ? b.passengers : [];

  const errors: Record<string, string> = {};
  const runDateMs = parseIstDate(runDate);
  if (runDateMs === null) errors['run_date'] = FIELD_MESSAGES.date;
  if (cls !== 'SL' && cls !== '3A') errors['class'] = FIELD_MESSAGES.class;
  if (!['GN', 'TQ', 'LD', 'SS'].includes(quota)) errors['quota'] = FIELD_MESSAGES.quota;
  if (passengers.length < 1) errors['passengers'] = 'Add at least one passenger aged 5 or over';
  passengers.forEach((p, i) => {
    const age = (p as { age?: unknown }).age;
    if (typeof age !== 'number' || !Number.isInteger(age) || age < 0 || age > 125) {
      errors[`passengers[${i}].age`] = FIELD_MESSAGES.age;
    }
  });
  const rc = runContext(train.number, runDateMs ?? 0);
  const fromIdx = rc ? rc.stops.findIndex((s) => s.code === from) : -1;
  const toIdx = rc ? rc.stops.findIndex((s) => s.code === to) : -1;
  if (!rc || fromIdx === -1 || toIdx === -1) throw err(404, 'not_found', 'No train has this number.');
  if (fromIdx >= toIdx) errors['to'] = FIELD_MESSAGES.not_calling;
  if (Object.keys(errors).length > 0) throw validation(errors);

  const km = rc.stops[toIdx].km - rc.stops[fromIdx].km;
  const tatkal = quota === 'TQ';
  const lines: { label: string; amount_paise: number }[] = [];
  let total = 0;
  let gstTotal = 0;
  passengers.forEach((p, i) => {
    const age = (p as { age: number }).age;
    if (age >= 5) {
      const before = fareBeforeGstPaise(km, cls, tatkal);
      gstTotal += gstOnFarePaise(before, cls);
      lines.push({ label: `Passenger ${i + 1} fare`, amount_paise: before });
      total += before + gstOnFarePaise(before, cls);
    } else {
      lines.push({ label: `Passenger ${i + 1} — under five, no berth`, amount_paise: 0 });
    }
  });
  if (cls === '3A') lines.push({ label: 'GST 5%', amount_paise: gstTotal });
  return { lines, total_paise: total };
}

// ---------- booking body ----------

interface HistoryRow { passenger: number; at: Date; from_label: string; to_label: string }

export async function bookingBody(c: PoolClient, pnr: string, forAccount: string): Promise<Record<string, unknown>> {
  const b = await loadBooking(c, pnr);
  if (!b || b.account_id !== forAccount) throw err(404, 'not_found', 'No booking has this PNR.');
  return bookingBodyWith(c, b);
}

async function bookingBodyWith(c: PoolClient, b: BookingRow): Promise<Record<string, unknown>> {
  const rc = runContext(b.train, Date.parse(b.run_date + 'T00:00:00+05:30'))!;
  const now = nowMs();
  const chartPrepared = now >= rc.chartMs;
  const arrival = rc.stops[b.to_idx].depMs;
  const state = now > arrival ? 'journey_complete' : (chartPrepared ? 'chart_prepared' : 'booked');
  const chartDone = (
    await c.query('SELECT 1 FROM chart_done WHERE train = $1 AND run_date = $2', [b.train, b.run_date])
  ).rowCount;
  // From the chart instant the reported version already counts the chart.
  const version = b.version + (chartPrepared && (chartDone ?? 0) === 0 ? 1 : 0);

  const passengers = await loadPassengers(c, b.pnr);
  const history = (
    await c.query<HistoryRow>(
      'SELECT passenger, at, from_label, to_label FROM passenger_history WHERE pnr = $1 ORDER BY at, passenger', [b.pnr],
    )
  ).rows;
  const tickets = (
    await c.query<{ version: number; kind: string; created_at: Date }>(
      'SELECT version, kind, created_at FROM tickets WHERE pnr = $1 ORDER BY version', [b.pnr],
    )
  ).rows;
  const cancellations = (
    await c.query<{ number: number; requested_at: Date; refund_paise: string }>(
      'SELECT number, requested_at, refund_paise FROM cancellations WHERE pnr = $1 ORDER BY number', [b.pnr],
    )
  ).rows;
  const cancellationPassengers = (
    await c.query<{ cancellation: number; number: number; band: string; charge_paise: string; gst_paise: string; deduction_paise: string; refund_paise: string }>(
      'SELECT cancellation, number, band, charge_paise, gst_paise, deduction_paise, refund_paise FROM cancellation_passengers WHERE pnr = $1 ORDER BY cancellation, number', [b.pnr],
    )
  ).rows;
  const refunds = (
    await c.query<{ number: number; reason: string; refund_paise: string; status: string; issued_at: Date | null }>(
      'SELECT number, reason, refund_paise, status, issued_at FROM refunds WHERE pnr = $1 ORDER BY number', [b.pnr],
    )
  ).rows;

  const statusObj = (label: string, p: typeof passengers[number]) => {
    const first = label.split(' ')[0];
    if (first === 'CNF') {
      return { status: 'CNF', position: null, coach: p.coach, berth: p.berth, berth_type: p.berth_type, label };
    }
    if (first === 'RAC') {
      return { status: 'RAC', position: p.rac_place, coach: p.coach, berth: p.berth, berth_type: 'SL', label };
    }
    if (['GNWL', 'RLWL', 'PQWL', 'TQWL'].includes(first)) {
      const m = /^(\w+) (\d+)$/.exec(label);
      return {
        status: m ? m[1] : first, position: m ? Number(m[2]) : p.wl_num,
        coach: null, berth: null, berth_type: null, label,
      };
    }
    if (first === 'NOSB') return { status: 'NOSB', position: null, coach: null, berth: null, berth_type: null, label };
    if (first === 'CAN') return { status: 'CAN', position: null, coach: null, berth: null, berth_type: null, label };
    return { status: 'CHART_NOT_CONFIRMED', position: null, coach: null, berth: null, berth_type: null, label: 'NOT CNF' };
  };

  const bookingStatusOf = (n: number, current: string) => {
    const h = history.find((x) => x.passenger === n);
    return h ? h.from_label : current;
  };

  return {
    pnr: b.pnr,
    version,
    state,
    train: { number: b.train, name: TRAINS.find((t) => t.number === b.train)?.name ?? b.train },
    run_date: b.run_date,
    from: { code: b.from_code, name: stationName(b.from_code) },
    to: { code: b.to_code, name: stationName(b.to_code) },
    class: b.cls,
    quota: b.quota,
    departure_at: istStamp(rc.stops[b.from_idx].depMs),
    arrival_at: istStamp(rc.stops[b.to_idx].depMs),
    chart_at: istStamp(rc.chartMs),
    chart_prepared: chartPrepared,
    keep_in_one_coach: b.keep_in_one_coach,
    lower_berth_only: b.lower_berth_only,
    contact_phone: b.contact_phone,
    total_paise: Number(b.total_paise),
    fare_lines: b.fare_lines,
    passengers: passengers.map((p) => {
      const current = labelFor(p);
      return {
        number: p.number,
        name: p.name,
        age: p.age,
        gender: p.gender,
        berth_preference: p.berth_preference,
        fare_paise: Number(p.fare_paise),
        booking_status: statusObj(bookingStatusOf(p.number, current), p),
        current_status: statusObj(current, p),
        history: history.filter((h) => h.passenger === p.number).map((h) => ({
          at: istStamp(h.at.getTime()),
          from_label: h.from_label,
          to_label: h.to_label,
        })),
      };
    }),
    tickets: tickets.map((t) => ({
      version: t.version, kind: t.kind, created_at: istStamp(t.created_at.getTime()),
    })),
    cancellations: cancellations.map((x) => ({
      number: x.number,
      requested_at: istStamp(x.requested_at.getTime()),
      passengers: cancellationPassengers.filter((p) => p.cancellation === x.number).map((p) => ({
        number: p.number,
        band: p.band,
        charge_paise: Number(p.charge_paise),
        gst_paise: Number(p.gst_paise),
        deduction_paise: Number(p.deduction_paise),
        refund_paise: Number(p.refund_paise),
      })),
      refund_paise: Number(x.refund_paise),
    })),
    refunds: refunds.map((r) => ({
      number: r.number,
      reason: r.reason,
      refund_paise: Number(r.refund_paise),
      status: r.status,
      issued_at: r.issued_at ? istStamp(r.issued_at.getTime()) : null,
    })),
  };
}

export async function listBookings(ctx: Ctx): Promise<unknown> {
  const a = await ctxAccount(ctx);
  const c = await pool.connect();
  try {
    const rows = (
      await c.query<BookingRow>("SELECT *, to_char(run_date, 'YYYY-MM-DD') AS run_date FROM bookings WHERE account_id = $1 ORDER BY created_at DESC", [a.id])
    ).rows;
    const out = [];
    for (const b of rows) {
      const passengers = await loadPassengers(c, b.pnr);
      const rc = runContext(b.train, Date.parse(b.run_date + 'T00:00:00+05:30'))!;
      const now = nowMs();
      const state = now > rc.stops[b.to_idx].depMs
        ? 'journey_complete'
        : (now >= rc.chartMs ? 'chart_prepared' : 'booked');
      out.push({
        pnr: b.pnr,
        train: { number: b.train, name: TRAINS.find((t) => t.number === b.train)?.name ?? b.train },
        run_date: b.run_date,
        from: b.from_code,
        to: b.to_code,
        class: b.cls,
        state,
        summary: passengers.map((p) => labelFor(p)).join(', '),
      });
    }
    return { bookings: out };
  } finally {
    c.release();
  }
}

// ---------- idempotency ----------

interface IdemRow { state: string; status: number | null; response_body: string | null; body_sha: string }

async function idemClaim(accountId: string, key: string, bodySha: string): Promise<'leader' | IdemRow> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ins = await pool.query(
      `INSERT INTO idempotency (account_id, key, body_sha, state)
       VALUES ($1,$2,$3,'running') ON CONFLICT (account_id, key) DO NOTHING`,
      [accountId, key, bodySha],
    );
    if ((ins.rowCount ?? 0) > 0) return 'leader';
    const row = (
      await pool.query<IdemRow>(
        'SELECT state, status, response_body, body_sha FROM idempotency WHERE account_id = $1 AND key = $2',
        [accountId, key],
      )
    ).rows[0];
    if (!row) continue; // the leader failed and removed its claim; try to lead
    if (row.state === 'done') return row;
    if (Date.now() > deadline) {
      // a leader that never finished is treated as failed
      await pool.query('DELETE FROM idempotency WHERE account_id = $1 AND key = $2 AND state = \'running\'', [accountId, key]);
      continue;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
}

function bodySha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function withIdempotency(
  ctx: Ctx,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown; replay: boolean }> {
  const account = await ctxAccount(ctx);
  const key = ctx.idempotencyKey ?? '';
  if (key.length < 1 || key.length > 100 || !/^[\x20-\x7E]+$/.test(key)) {
    throw err(400, 'idempotency_key_required', 'Send an Idempotency-Key header.');
  }
  const sha = bodySha(ctx.rawBody ?? Buffer.alloc(0));
  const claim = await idemClaim(account.id, key, sha);
  if (claim !== 'leader') {
    if (claim.body_sha !== sha) {
      throw err(409, 'idempotency_conflict', 'This key was used with a different request.');
    }
    return { status: claim.status ?? 201, body: JSON.parse(claim.response_body ?? 'null'), replay: true };
  }
  try {
    const result = await run();
    await pool.query(
      `UPDATE idempotency SET state = 'done', status = $1, response_body = $2, updated_at = now()
       WHERE account_id = $3 AND key = $4`,
      [result.status, JSON.stringify(result.body), account.id, key],
    );
    return { ...result, replay: false };
  } catch (e) {
    // a failed request is never stored: the same key can be retried
    await pool.query('DELETE FROM idempotency WHERE account_id = $1 AND key = $2', [account.id, key]);
    throw e;
  }
}

// ---------- POST /api/bookings ----------

export async function postBooking(ctx: Ctx): Promise<{ status: number; body: unknown; replay: boolean }> {
  const account = await ctxAccount(ctx);
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  const input: BookingInput = {
    train: str(raw.train),
    run_date: str(raw.run_date),
    from: str(raw.from),
    to: str(raw.to),
    class: str(raw.class) as ClassCode,
    quota: (str(raw.quota) || 'GN') as QuotaCode,
    passengers: (Array.isArray(raw.passengers) ? raw.passengers : []).map((p) => {
      const x = p as Record<string, unknown>;
      return {
        name: str(x.name), age: x.age as number, gender: str(x.gender) as Gender,
        berth_preference: (str(x.berth_preference) || 'NONE') as BerthPref,
      };
    }),
    keep_in_one_coach: raw.keep_in_one_coach === true,
    lower_berth_only: raw.lower_berth_only === true,
    accept: str(raw.accept) as AcceptCode,
    contact_phone: str(raw.contact_phone),
  };
  return withIdempotency(ctx, async () => {
    const pnr = await withTx(async (c) => {
      const r = await createBooking(c, {
        accountId: account.id, accountEmail: account.email, accountName: account.name,
      }, input);
      if (!r.ok) {
        const f = r.failure;
        switch (f.kind) {
          case 'not_found': throw err(404, 'not_found', 'No train has this number.');
          case 'field': throw validation(f.errors);
          case 'booking_not_open': throw err(409, 'booking_not_open', 'Bookings for this train are not open yet.', { opens_at: f.opens_at });
          case 'tatkal_not_open': throw err(409, 'tatkal_not_open', 'Tatkal is not open yet.', { opens_at: f.opens_at });
          case 'chart_prepared': throw err(409, 'chart_prepared', 'The chart for this train is prepared.');
          case 'quota_full': throw err(409, 'quota_full', 'Not enough quota berths are left.', { charged: false });
          case 'waitlist_full': throw err(409, 'waitlist_full', 'The waiting list is full.', { charged: false });
          case 'party_split': throw err(409, 'party_split', 'The party could not be kept in one coach.', { charged: false });
          case 'no_lower_berth': throw err(409, 'no_lower_berth', 'No lower berth could be allotted.', { charged: false });
          case 'availability_changed': throw err(409, 'availability_changed', 'Availability changed before you paid.', {
            charged: false,
            offer: { accept: f.offerAccept, label: f.offerLabel },
          });
          case 'payment_unavailable': throw err(503, 'payment_unavailable', 'Payments are down right now.');
          case 'ticket_storage_unavailable': throw err(503, 'ticket_storage_unavailable', "E-tickets can't be saved right now.");
        }
      }
      return r.pnr;
    });
    const c = await pool.connect();
    try {
      const body = await bookingBody(c, pnr, account.id);
      return { status: 201, body };
    } finally {
      c.release();
    }
  });
}

// ---------- cancellations ----------

function cancelFailure(f: CancelFailure): ApiError {
  switch (f.kind) {
    case 'not_found': return err(404, 'not_found', 'No booking has this PNR.');
    case 'field': return validation(f.errors);
    case 'already_cancelled': return err(409, 'already_cancelled', 'That passenger is already cancelled.');
    case 'journey_complete': return err(409, 'journey_complete', 'This journey is complete.');
  }
}

export async function postCancellationQuote(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const account = await ctxAccount(ctx);
  const pnr = ctx.path.split('/')[3] ?? '';
  const raw = (ctx.body ?? {}) as { passengers?: unknown };
  const numbers = (Array.isArray(raw.passengers) ? raw.passengers : []).map((n) => Number(n));
  const c = await pool.connect();
  try {
    const b = await loadBooking(c, pnr);
    if (!b || b.account_id !== account.id) throw err(404, 'not_found', 'No booking has this PNR.');
    const result = await cancellationQuote(c, pnr, numbers);
    if (!result.ok) throw cancelFailure(result.failure);
    return {
      status: 200,
      body: {
        quoted_at: result.quoted_at,
        passengers: result.passengers,
        refund_paise: result.refund_paise,
      },
    };
  } finally {
    c.release();
  }
}

export async function postCancellation(ctx: Ctx): Promise<{ status: number; body: unknown; replay: boolean }> {
  const account = await ctxAccount(ctx);
  const pnr = ctx.path.split('/')[3] ?? '';
  const raw = (ctx.body ?? {}) as { passengers?: unknown };
  const numbers = (Array.isArray(raw.passengers) ? raw.passengers : []).map((n) => Number(n));
  return withIdempotency(ctx, async () => {
    const result = await withTx(async (c) => {
      const r = await cancelPassengers(c, pnr, numbers, account.email);
      if (!r.ok) throw cancelFailure(r.failure);
      try {
        await storeTicket(c, pnr, r.result.ticketVersion, 'cancellation', new Date());
      } catch (e) {
        if (!(e instanceof StorageDown)) throw e;
        // stored within 60 real seconds of MinIO becoming reachable again
      }
      return r.result;
    });
    const c = await pool.connect();
    try {
      const body = await bookingBody(c, pnr, account.id);
      return {
        status: 201,
        body: {
          cancellation: {
            number: result.cancellationNumber,
            requested_at: istStamp(nowMs()),
            passengers: result.passengers,
            refund_paise: result.refundTotal,
          },
          refund: result.refundRow ? { ...result.refundRow, issued_at: null } : null,
          booking: body,
        },
      };
    } finally {
      c.release();
    }
  });
}

// ---------- public PNR ----------

export async function publicPnr(ctx: Ctx): Promise<unknown> {
  const pnr = ctx.path.split('/')[3] ?? '';
  const c = await pool.connect();
  try {
    const b = await loadBooking(c, pnr);
    if (!b) throw err(404, 'not_found', 'No booking has this PNR.');
    const rc = runContext(b.train, Date.parse(b.run_date + 'T00:00:00+05:30'))!;
    const passengers = await loadPassengers(c, pnr);
    const history = (
      await c.query<{ passenger: number; from_label: string }>(
        'SELECT passenger, from_label FROM passenger_history WHERE pnr = $1 ORDER BY at, passenger', [pnr],
      )
    ).rows;
    return {
      pnr,
      train: { number: b.train, name: TRAINS.find((t) => t.number === b.train)?.name ?? b.train },
      run_date: b.run_date,
      from: b.from_code,
      to: b.to_code,
      class: b.cls,
      chart_prepared: nowMs() >= rc.chartMs,
      passengers: passengers.map((p) => {
        const current = labelFor(p);
        const h = history.find((x) => x.passenger === p.number);
        return {
          number: p.number,
          booking_status: h ? h.from_label : current,
          current_status: current,
        };
      }),
    };
  } finally {
    c.release();
  }
}

// ---------- ticket download ----------

export async function downloadTicket(ctx: Ctx): Promise<{ status: number; body: Buffer; headers: Record<string, string> }> {
  const account = await ctxAccount(ctx);
  const parts = ctx.path.split('/');
  const pnr = parts[3] ?? '';
  const version = Number(parts[5] ?? '0');
  const c = await pool.connect();
  try {
    const b = await loadBooking(c, pnr);
    if (!b || b.account_id !== account.id) throw err(404, 'not_found', 'No booking has this PNR.');
    const t = (
      await c.query<{ kind: string; stored: boolean }>(
        'SELECT kind, stored FROM tickets WHERE pnr = $1 AND version = $2', [pnr, version],
      )
    ).rows[0];
    if (!t || !t.stored) throw err(404, 'not_found', 'No e-ticket has this version.');
    try {
      const obj = await getTicket(ticketKey(pnr, version, t.kind));
      if (!obj) throw err(404, 'not_found', 'No e-ticket has this version.');
      return {
        status: 200,
        body: obj.bytes,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="e-ticket-${pnr}-v${version}.pdf"`,
          ETag: obj.etag,
        },
      };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof StorageDown) throw err(503, 'ticket_storage_unavailable', "E-tickets can't be downloaded right now.");
      throw e;
    }
  } finally {
    c.release();
  }
}
