import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import { pool, applySchema, waitForDatabase, getPractice, getUserByEmail, createSession, getSession, deleteSession, getStates, getEditions } from './db.js';
import { HttpError, wrap, notFound, forbidden, validation } from './http.js';
import { hashPassword, verifyPassword, newId, newToken } from './domain/passwords.js';
import { SEED_STATES } from './domain/seed.js';
import { computeDue, practiceNow } from './domain/due.js';
import { serializeReturn } from './serialize.js';
import { getReturnById, listReturns, isRowOverdue, type ReturnRow } from './returns.js';
import { sseHandler, emitEvent } from './live.js';
import { runWorkOnce, syncReminders, queueNotice, loadState } from './services/work.js';
import { probeServices, mailUp, pdfUp, SERVICE_RETRY_SECONDS } from './services/outbound.js';
import { carryForward, deadlineInstant } from '../shared/deadlines.js';
import { periodLabel, generatedPeriods, PRACTICE_ZONE, type Frequency } from '../shared/periods.js';
import type { ReturnJson, StateJson } from '../shared/types.js';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? '4173');
const SESSION_TTL = Number(process.env.SESSION_TTL_SECONDS ?? '604800');
const GRADING_KEY = process.env.GRADING_KEY ?? '';
const BODY_LIMIT = 100_000;

interface Practice {
  id: string;
  clockNow: Date | null;
  reminderHour: number;
}

async function currentPractice(practiceId: string): Promise<Practice> {
  const practice = await getPractice(practiceId);
  if (practice === null) throw notFound();
  return { id: practice.id, clockNow: practice.clock_now, reminderHour: practice.reminder_hour };
}

function practiceInstant(practice: Practice): Date {
  return practiceNow(practice.clockNow);
}

const app = express();
app.disable('x-powered-by');

// A JSON route with a non-JSON content type is refused before the parser runs.
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    if (req.path.startsWith('/api/')) {
      const contentType = req.headers['content-type'] ?? '';
      const base = contentType.split(';')[0]?.trim() ?? '';
      if (base !== '' && base !== 'application/json') {
        res.status(415).json({ error: 'unsupported_media_type' });
        return;
      }
    }
  }
  next();
});
app.use(express.json({ limit: BODY_LIMIT, type: 'application/json' }));

// Same-origin boundary: a state-changing request from another origin is refused.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    const host = req.headers.host;
    try {
      const parsed = new URL(origin);
      if (host === undefined || parsed.host !== host) {
        res.status(403).json({ error: 'cross_origin' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'cross_origin' });
      return;
    }
  }
  next();
});

/** Load the session into req.user before each request. */
app.use(wrap(async (req, _res, next) => {
  const cookies = req.headers.cookie;
  if (cookies !== undefined) {
    const token = /(?:^|;\s*)duefield_session=([^;]+)/.exec(cookies)?.[1];
    if (token !== undefined) {
      const session = await getSession(token);
      if (session !== null) {
        req.user = session.user;
        req.sessionToken = token;
      }
    }
  }
  next();
}));

interface SessionUser {
  id: string;
  practice_id: string;
  role: 'bookkeeper' | 'owner';
  display_name: string;
  email: string;
  password_hash: string;
  client_id: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    sessionToken?: string;
  }
}

/** Params where every named parameter is a string. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

// ---------- validation helpers ----------

const AMOUNT_RE = /^(?!0\d)\d{1,12}\.\d{2}$/;
const RATE_RE = /^\d{1,3}\.\d{3}$/;

function requireSession(req: Request): SessionUser {
  if (req.user === undefined) throw new HttpError(401, 'sign_in_required');
  return req.user;
}

function requireBookkeeper(req: Request): SessionUser {
  const user = requireSession(req);
  if (user.role !== 'bookkeeper') throw forbidden();
  return user;
}

async function openReturn(req: Request, returnId: string): Promise<ReturnRow> {
  const row = await getReturnById(returnId);
  // The record itself cannot be opened: 404 before any role check, signed out included.
  if (row === null) throw notFound();
  const user = req.user;
  if (user === undefined) throw notFound();
  if (row.practice_id !== user.practice_id) throw notFound();
  if (user.role === 'owner' && row.client_id !== user.client_id) throw notFound();
  return row;
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `duefield_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}`,
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', 'duefield_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function seedStates(practiceId: string): Promise<void> {
  for (const state of SEED_STATES) {
    await pool.query('insert into states (practice_id, code, name, zone, holidays) values ($1, $2, $3, $4, $5)', [
      practiceId,
      state.code,
      state.name,
      state.zone,
      state.holidays,
    ]);
    await pool.query(
      'insert into editions (practice_id, state_code, effective_date, due_day, carry, rate, extension_days) values ($1, $2, $3, $4, $5, $6, $7)',
      [practiceId, state.code, '2020-01-01', state.due_day, state.carry, state.rate, state.extension_days],
    );
  }
}

// ---------- auth ----------

app.post('/api/auth/signup', wrap(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const displayName = body.display_name;
  const email = body.email;
  const password = body.password;
  if (typeof displayName !== 'string' || displayName.trim() === '') errors.display_name = 'Enter your name.';
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) errors.password = 'Use at least 8 characters.';
  if (Object.keys(errors).length > 0) throw validation(errors);
  const existing = await getUserByEmail(email as string);
  if (existing !== null) {
    throw validation({ email: 'An account with this email already exists.' });
  }
  const practiceId = newId('practice');
  await pool.query('insert into practices (id) values ($1)', [practiceId]);
  const userId = newId('user');
  await pool.query(
    'insert into users (id, practice_id, role, display_name, email, password_hash) values ($1, $2, $3, $4, $5, $6)',
    [userId, practiceId, 'bookkeeper', (displayName as string).trim(), (email as string).toLowerCase(), hashPassword(password as string)],
  );
  await seedStates(practiceId);
  const token = newToken();
  await createSession(token, userId, SESSION_TTL);
  setSessionCookie(res, token);
  res.status(201).json({
    practice_id: practiceId,
    user: { id: userId, display_name: (displayName as string).trim(), email: (email as string).toLowerCase(), role: 'bookkeeper', client_id: null },
  });
}));

app.post('/api/auth/signin', wrap(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await getUserByEmail(email);
  if (user === null || !verifyPassword(password, user.password_hash)) {
    throw validation({ email: 'Email or password is wrong.' });
  }
  const token = newToken();
  await createSession(token, user.id, SESSION_TTL);
  setSessionCookie(res, token);
  res.json({
    user: {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      client_id: user.client_id,
    },
  });
}));

app.post('/api/auth/signout', wrap(async (req, res) => {
  if (req.sessionToken !== undefined) await deleteSession(req.sessionToken);
  clearSessionCookie(res);
  res.status(204).end();
}));

app.get('/api/me', wrap(async (req, res) => {
  const user = requireSession(req);
  const practice = await currentPractice(user.practice_id);
  res.json({
    user: {
      id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      client_id: user.client_id,
    },
    practice_id: user.practice_id,
    now: practiceInstant(practice).toISOString(),
    practice_zone: PRACTICE_ZONE,
    reminder_hour: practice.reminderHour,
  });
}));

app.patch('/api/practice', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const body = req.body as Record<string, unknown>;
  const hour = body.reminder_hour;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 6 || hour > 21) {
    throw validation({ reminder_hour: 'Choose a whole hour from 6 to 21.' });
  }
  await pool.query('update practices set reminder_hour = $1 where id = $2', [hour, user.practice_id]);
  const unfiled = await pool.query(
    `select r.id from returns r where r.practice_id = $1 and r.status in ('not_started','prepared','client_approved')`,
    [user.practice_id],
  );
  for (const row of unfiled.rows) {
    await syncReminders(row.id);
  }
  const practice = await currentPractice(user.practice_id);
  await runWorkOnce(user.practice_id, practiceInstant(practice));
  res.json({ reminder_hour: hour });
}));

// ---------- states ----------

async function serializeStates(practiceId: string): Promise<StateJson[]> {
  const states = await getStates(practiceId);
  const editions = await getEditions(practiceId);
  return states.map((state) => ({
    code: state.code,
    name: state.name,
    zone: state.zone,
    zone_label: zoneLabelOf(state.zone),
    holidays: [...state.holidays].sort(),
    editions: editions
      .filter((e) => e.state_code === state.code)
      .map((e) => ({
        effective_date: e.effective_date,
        due_day: e.due_day,
        carry: e.carry,
        rate: e.rate,
        extension_days: e.extension_days,
      })),
  }));
}

function zoneLabelOf(zone: string): string {
  const labels: Record<string, string> = {
    'America/New_York': 'Eastern',
    'America/Chicago': 'Central',
    'America/Denver': 'Mountain',
    'America/Phoenix': 'Arizona',
    'America/Los_Angeles': 'Pacific',
    'Pacific/Honolulu': 'Hawaii',
  };
  return labels[zone] ?? zone;
}

app.get('/api/states', wrap(async (req, res) => {
  requireBookkeeper(req);
  res.json(await serializeStates(req.user!.practice_id));
}));

app.put('/api/states/:code/holidays', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const code = param(req, 'code');
  const states = await getStates(user.practice_id);
  const state = states.find((s) => s.code === code);
  if (state === undefined) throw notFound();
  const body = req.body as Record<string, unknown>;
  const holidays = body.holidays;
  const errors: Record<string, string> = {};
  const list: string[] = [];
  if (!Array.isArray(holidays)) {
    errors.holidays = 'Enter dates as YYYY-MM-DD, one per line.';
  } else {
    for (const item of holidays) {
      if (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item) || !DateTime.fromISO(item).isValid) {
        errors.holidays = 'Enter dates as YYYY-MM-DD, one per line.';
        break;
      }
      list.push(item);
    }
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  await pool.query('update states set holidays = $1 where practice_id = $2 and code = $3', [
    [...new Set(list)].sort(),
    user.practice_id,
    code,
  ]);
  // Recalculate every not_started return of this state under the new list.
  const affected = await pool.query(
    `select r.id from returns r where r.practice_id = $1 and r.state_code = $2 and r.status = 'not_started'`,
    [user.practice_id, code],
  );
  const freshState = await loadState(user.practice_id, code);
  if (freshState !== null) {
    for (const row of affected.rows) {
      const ret = await getReturnById(row.id);
      if (ret === null) continue;
      const due = computeDue(freshState, ret.period, ret.frequency, ret.extension_days_used);
      await pool.query(
        `update returns set due_date = $1, nominal_due_date = $2, due_at = $3 where id = $4`,
        [due.due_date, due.unextended_nominal_date, due.due_at, row.id],
      );
      await syncReminders(row.id);
    }
  }
  emitEvent(user.practice_id, { kind: 'holidays_saved', state: code });
  res.json((await serializeStates(user.practice_id)).find((s) => s.code === code));
}));

app.post('/api/states/:code/editions', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const code = param(req, 'code');
  const states = await getStates(user.practice_id);
  const state = states.find((s) => s.code === code);
  if (state === undefined) throw notFound();
  const body = req.body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const effective = body.effective_date;
  const dueDay = body.due_day;
  const carry = body.carry;
  const rate = body.rate;
  const extensionDays = body.extension_days;
  if (typeof effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effective) || !DateTime.fromISO(effective).isValid) {
    errors.effective_date = 'Enter a date as YYYY-MM-DD.';
  }
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    errors.due_day = 'Enter a due day from 1 to 31.';
  }
  if (carry !== 'next_business' && carry !== 'fixed') {
    errors.carry = 'Choose a carry-forward rule.';
  }
  if (typeof rate !== 'string' || !RATE_RE.test(rate)) {
    errors.rate = 'Enter a rate with three decimals.';
  }
  if (typeof extensionDays !== 'number' || !Number.isInteger(extensionDays) || extensionDays < 0 || extensionDays > 180) {
    errors.extension_days = 'Enter whole days from 0 to 180.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const existing = await pool.query(
    'select effective_date from editions where practice_id = $1 and state_code = $2 and effective_date = $3',
    [user.practice_id, code, effective],
  );
  if (existing.rows.length > 0) {
    throw validation({ effective_date: 'An edition already starts on this date.' });
  }
  await pool.query(
    `insert into editions (practice_id, state_code, effective_date, due_day, carry, rate, extension_days)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [user.practice_id, code, effective, dueDay, carry, rate, extensionDays],
  );
  // Recalculate only the not_started returns whose period starts on or after the effective date.
  const freshState = await loadState(user.practice_id, code);
  const recalculated: string[] = [];
  if (freshState !== null) {
    const zone = freshState.zone;
    const effectiveLocal = DateTime.fromISO(effective as string, { zone }).startOf('day');
    const affected = await pool.query(
      `select r.id, r.period from returns r where r.practice_id = $1 and r.state_code = $2 and r.status = 'not_started'`,
      [user.practice_id, code],
    );
    for (const row of affected.rows) {
      const periodStart = DateTime.fromISO(`${row.period.slice(0, 4)}-${periodStartMonth(row.period)}-01`, { zone }).startOf('day');
      if (periodStart < effectiveLocal) continue;
      const ret = await getReturnById(row.id);
      if (ret === null) continue;
      const due = computeDue(freshState, ret.period, ret.frequency, ret.extension_days_used);
      await pool.query(
        `update returns set due_date = $1, nominal_due_date = $2, due_at = $3,
           edition_effective_date = $4, due_day = $5, carry = $6, rate = $7, extension_days = $8
         where id = $9`,
        [
          due.due_date, due.unextended_nominal_date, due.due_at,
          due.edition.effective_date, due.edition.due_day, due.edition.carry,
          due.edition.rate, due.edition.extension_days, row.id,
        ],
      );
      await syncReminders(row.id);
      recalculated.push(row.id);
    }
  }
  emitEvent(user.practice_id, { kind: 'edition_published', state: code, recalculated });
  res.status(201).json({
    edition: {
      effective_date: effective as string,
      due_day: dueDay as number,
      carry: carry as 'next_business' | 'fixed',
      rate: rate as string,
      extension_days: extensionDays as number,
    },
    recalculated,
  });
}));

function periodStartMonth(period: string): string {
  if (period.length === 4) return '01';
  if (period.includes('Q')) return String((Number(period.slice(5)) - 1) * 3 + 1).padStart(2, '0');
  return period.slice(5);
}

// ---------- clients and registrations ----------

app.get('/api/clients', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const clients = await pool.query(
    'select id, name from clients where practice_id = $1 order by name',
    [user.practice_id],
  );
  const owners = await pool.query(
    `select client_id, id, display_name, email from users where practice_id = $1 and role = 'owner'`,
    [user.practice_id],
  );
  const registrations = await pool.query(
    'select id, client_id, state_code, frequency, first_period from registrations where practice_id = $1 order by state_code',
    [user.practice_id],
  );
  const result = clients.rows.map((client) => {
    const owner = owners.rows.find((o) => o.client_id === client.id);
    return {
      id: client.id,
      name: client.name,
      owner: {
        id: owner?.id ?? '',
        display_name: owner?.display_name ?? '',
        email: owner?.email ?? '',
      },
      registrations: registrations.rows
        .filter((r) => r.client_id === client.id)
        .map((r) => ({
          id: r.id,
          state: r.state_code,
          frequency: r.frequency,
          first_period: r.first_period,
        })),
    };
  });
  res.json(result);
}));

app.post('/api/clients', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const body = req.body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const name = body.name;
  const owner = (body.owner ?? {}) as Record<string, unknown>;
  const displayName = owner.display_name;
  const email = owner.email;
  const password = owner.password;
  if (typeof name !== 'string' || name.trim() === '') errors.name = 'Enter a business name.';
  if (typeof displayName !== 'string' || displayName.trim() === '') errors['owner.display_name'] = "Enter the owner's name.";
  if (!validEmail(email)) errors['owner.email'] = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) errors['owner.password'] = 'Use at least 8 characters.';
  if (Object.keys(errors).length > 0) throw validation(errors);
  const existing = await getUserByEmail(email as string);
  if (existing !== null) throw validation({ 'owner.email': 'An account with this email already exists.' });
  const clientId = newId('client');
  const ownerId = newId('user');
  const client = await pool.query(
    'insert into clients (id, practice_id, name) values ($1, $2, $3) returning id, name',
    [clientId, user.practice_id, (name as string).trim()],
  );
  await pool.query(
    `insert into users (id, practice_id, role, display_name, email, password_hash, client_id)
     values ($1, $2, 'owner', $3, $4, $5, $6)`,
    [ownerId, user.practice_id, (displayName as string).trim(), (email as string).toLowerCase(), hashPassword(password as string), clientId],
  );
  res.status(201).json({
    id: client.rows[0].id,
    name: client.rows[0].name,
    owner: {
      id: ownerId,
      display_name: (displayName as string).trim(),
      email: (email as string).toLowerCase(),
    },
    registrations: [],
  });
}));

function parsePeriod(value: unknown, frequency: Frequency): string | null {
  if (typeof value !== 'string') return null;
  if (frequency === 'monthly' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  if (frequency === 'quarterly' && /^\d{4}-Q[1-4]$/.test(value)) return value;
  if (frequency === 'yearly' && /^\d{4}$/.test(value)) return value;
  return null;
}

app.post('/api/clients/:clientId/registrations', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const clientResult = await pool.query(
    'select id, name from clients where id = $1 and practice_id = $2',
    [param(req, 'clientId'), user.practice_id],
  );
  const client = clientResult.rows[0];
  if (client === undefined) throw notFound();
  const body = req.body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const stateCode = body.state;
  const frequency = body.frequency;
  const firstPeriod = body.first_period;
  const states = await getStates(user.practice_id);
  if (typeof stateCode !== 'string' || !states.some((s) => s.code === stateCode)) {
    errors.state = 'Choose a state.';
  }
  if (frequency !== 'monthly' && frequency !== 'quarterly' && frequency !== 'yearly') {
    errors.frequency = 'Choose a filing frequency.';
  }
  let first: string | null = null;
  let frequencyValue: Frequency;
  if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly') {
    frequencyValue = frequency;
    first = parsePeriod(firstPeriod, frequency);
    if (first === null) errors.first_period = 'Enter a period like 2026-05, 2026-Q2 or 2026 to match the frequency.';
  } else {
    throw validation(errors);
  }
  if (errors.state === undefined && typeof stateCode === 'string') {
    const clash = await pool.query(
      `select id from registrations where practice_id = $1 and client_id = $2 and state_code = $3`,
      [user.practice_id, client.id, stateCode],
    );
    if (clash.rows.length > 0) errors.state = 'This client is already registered in this state.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const registrationId = newId('reg');
  const stateCodeValue = stateCode;
  if (typeof stateCodeValue !== 'string' || first === null) throw validation(errors);
  const firstPeriodValue: string = first;
  await pool.query(
    'insert into registrations (id, client_id, practice_id, state_code, frequency, first_period) values ($1, $2, $3, $4, $5, $6)',
    [registrationId, client.id, user.practice_id, stateCodeValue, frequencyValue, first],
  );
  const state = await loadState(user.practice_id, stateCodeValue);
  if (state === null) throw notFound();
  const created: ReturnJson[] = [];
  const periods = generatedPeriods(frequencyValue, firstPeriodValue);
  const now = practiceInstant(await currentPractice(user.practice_id));
  for (const period of periods) {
    const due = computeDue(state, period, frequencyValue, null);
    const returnId = newId('ret');
    await pool.query(
      `insert into returns (id, practice_id, client_id, registration_id, state_code, frequency, period,
         status, version, gross_sales, tax_due, edition_effective_date, due_day, carry, rate, extension_days,
         unextended_nominal_date, nominal_due_date, due_date, due_at, packet_state, awaiting_approval,
         amounts_set, changed_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'not_started', 1, null, null, $8, $9, $10, $11, $12, $13, $13, $14, $15,
         'none', false, false, $16)`,
      [
        returnId, user.practice_id, client.id, registrationId, stateCodeValue,
        frequencyValue, period, due.edition.effective_date, due.edition.due_day,
        due.edition.carry, due.edition.rate, due.edition.extension_days,
        due.unextended_nominal_date, due.due_date, due.due_at, user.display_name,
      ],
    );
    await syncReminders(returnId);
    const row = await getReturnById(returnId);
    if (row !== null) created.push(await serializeReturn(row, now));
  }
  emitEvent(user.practice_id, { kind: 'registered', client: client.name, state: stateCodeValue });
  await runWorkOnce(user.practice_id, now);
  res.status(201).json({
    registration: { id: registrationId, state: stateCodeValue, frequency: frequencyValue, first_period: first },
    returns: created,
  });
}));

// ---------- returns ----------

function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate() ?? date;
}

function computeCarry(nominal: string, carry: 'next_business' | 'fixed', holidays: string[]): { dueDate: string } {
  return { dueDate: carryForward(nominal, carry, holidays).dueDate };
}

function deadlineOf(dueDate: string, zone: string): Date {
  return deadlineInstant(dueDate, zone);
}

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PARAM = /^\d{4}$/;

app.get('/api/returns', wrap(async (req, res) => {
  const user = requireSession(req);
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  const query = req.query as Record<string, unknown>;
  const month = query.month;
  const year = query.year;
  const errors: Record<string, string> = {};
  if (month !== undefined && (typeof month !== 'string' || !MONTH_PARAM.test(month))) {
    errors.month = 'Enter a month as YYYY-MM.';
  }
  if (year !== undefined && (typeof year !== 'string' || !YEAR_PARAM.test(year))) {
    errors.year = 'Enter a year as YYYY.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const rows = await listReturns(
    user.practice_id,
    {
      month: typeof month === 'string' ? month : undefined,
      year: typeof year === 'string' ? year : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      client: user.role === 'owner' ? (user.client_id ?? undefined) : typeof query.client === 'string' ? query.client : undefined,
    },
    now,
  );
  const serialized = await Promise.all(rows.map((row) => serializeReturn(row, now)));
  res.json({
    returns: serialized,
    counts: {
      total: serialized.length,
      overdue: serialized.filter((r) => r.overdue).length,
      awaiting_approval: serialized.filter((r) => r.awaiting_approval).length,
    },
  });
}));

app.get('/api/returns/:id', wrap(async (req, res) => {
  const row = await openReturn(req, param(req, 'id'));
  const practice = await currentPractice(row.practice_id);
  res.json(await serializeReturn(row, practiceInstant(practice)));
}));

/** The one version rule: a stale version changes nothing. */
async function versionCheck(row: ReturnRow, body: Record<string, unknown>): Promise<void> {
  const version = body.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw validation({ version: 'Send the version you last saw.' });
  }
  if (version !== row.version) {
    throw new HttpError(409, 'conflict', {
      version: row.version,
      status: row.status,
      changed_by: row.changed_by,
    });
  }
}

function amountErrors(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const gross = body.gross_sales;
  const tax = body.tax_due;
  if (typeof gross !== 'string' || !AMOUNT_RE.test(gross)) errors.gross_sales = 'Enter an amount with two decimals.';
  if (typeof tax !== 'string' || !AMOUNT_RE.test(tax)) errors.tax_due = 'Enter an amount with two decimals.';
  return errors;
}

function announceStatus(practiceId: string, row: ReturnRow): void {
  emitEvent(practiceId, {
    kind: 'return_changed',
    return_id: row.id,
    client_id: row.client_id,
    client: row.client_name,
    state: row.state_code,
    period_label: periodLabel(row.period),
    status: row.status,
    version: row.version,
    due_at: row.due_at.toISOString(),
    changed_by: row.changed_by,
  });
}

app.patch('/api/returns/:id', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  if (row.status !== 'not_started' && row.status !== 'prepared') {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const errors = amountErrors(body);
  if (Object.keys(errors).length > 0) throw validation(errors);
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  const wasAwaiting = row.awaiting_approval && row.status === 'prepared';
  await pool.query(
    `update returns set gross_sales = $1, tax_due = $2, version = version + 1, changed_by = $3,
       awaiting_approval = case when status = 'prepared' then true else awaiting_approval end,
       amounts_set = true
     where id = $4`,
    [body.gross_sales, body.tax_due, user.display_name, row.id],
  );
  if (row.status === 'prepared' && !wasAwaiting) {
    await queueNotice('approval_request', row.id, {});
  } else if (row.status === 'prepared') {
    await pool.query(`delete from notices where kind = 'approval_request' and return_id = $1`, [row.id]);
    await queueNotice('approval_request', row.id, {});
  }
  const fresh = await getReturnById(row.id);
  if (fresh !== null) {
    announceStatus(user.practice_id, fresh);
    emitEvent(user.practice_id, {
      kind: 'amounts_saved',
      return_id: row.id,
      client: row.client_name,
      state: row.state_code,
      period_label: periodLabel(row.period),
    });
  }
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/prepare', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  if (row.status !== 'not_started') {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const errors = amountErrors(body);
  if (Object.keys(errors).length > 0) throw validation(errors);
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  await pool.query(
    `update returns set status = 'prepared', gross_sales = $1, tax_due = $2, version = version + 1,
       changed_by = $3, awaiting_approval = true, prepared_at = $4, amounts_set = true
     where id = $5`,
    [body.gross_sales, body.tax_due, user.display_name, now, row.id],
  );
  await syncReminders(row.id);
  await queueNotice('approval_request', row.id, {});
  const fresh = await getReturnById(row.id);
  if (fresh !== null) announceStatus(user.practice_id, fresh);
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/approve', wrap(async (req, res) => {
  const user = requireSession(req);
  if (user.role !== 'owner') throw forbidden();
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  if (row.status !== 'prepared' || !row.awaiting_approval) {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  await pool.query(
    `update returns set status = 'client_approved', awaiting_approval = false,
       version = version + 1, changed_by = $1 where id = $2`,
    [user.display_name, row.id],
  );
  await pool.query(
    `insert into approvals (id, return_id, action, by_user_id, by_name, at)
     values ($1, $2, 'approved', $3, $4, $5)`,
    [newId('appr'), row.id, user.id, user.display_name, now],
  );
  await queueNotice('approved_notice', row.id, { owner_name: user.display_name });
  const fresh = await getReturnById(row.id);
  if (fresh !== null) {
    announceStatus(user.practice_id, fresh);
    emitEvent(user.practice_id, {
      kind: 'owner_approved',
      return_id: row.id,
      client_id: row.client_id,
      owner_name: user.display_name,
      state: row.state_code,
      period_label: periodLabel(row.period),
    });
  }
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/send-back', wrap(async (req, res) => {
  const user = requireSession(req);
  if (user.role !== 'owner') throw forbidden();
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  const canSendBack = (row.status === 'prepared' && row.awaiting_approval) || row.status === 'client_approved';
  if (!canSendBack) {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const reason = body.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw validation({ reason: 'Give a reason for sending this back.' });
  }
  if (reason.length > 500) {
    throw validation({ reason: 'Keep the reason to 500 characters or fewer.' });
  }
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  await pool.query(
    `update returns set status = 'prepared', awaiting_approval = false,
       version = version + 1, changed_by = $1 where id = $2`,
    [user.display_name, row.id],
  );
  await pool.query(
    `insert into approvals (id, return_id, action, by_user_id, by_name, reason, at)
     values ($1, $2, 'sent_back', $3, $4, $5, $6)`,
    [newId('appr'), row.id, user.id, user.display_name, reason, now],
  );
  await queueNotice('sent_back_notice', row.id, { owner_name: user.display_name, reason });
  const fresh = await getReturnById(row.id);
  if (fresh !== null) {
    announceStatus(user.practice_id, fresh);
    emitEvent(user.practice_id, {
      kind: 'owner_sent_back',
      return_id: row.id,
      client_id: row.client_id,
      owner_name: user.display_name,
      state: row.state_code,
      period_label: periodLabel(row.period),
    });
  }
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/file', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  if (row.status !== 'client_approved') {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  await pool.query(
    `update returns set status = 'filed', filed_at = $1, awaiting_approval = false,
       packet_state = 'pending', version = version + 1, changed_by = $2 where id = $3`,
    [now, user.display_name, row.id],
  );
  await pool.query(`delete from reminders where return_id = $1 and status = 'pending'`, [row.id]);
  await queueNotice('filed_notice', row.id, {});
  const fresh = await getReturnById(row.id);
  if (fresh !== null) announceStatus(user.practice_id, fresh);
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/extension', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  if (row.status !== 'not_started' && row.status !== 'prepared' && row.status !== 'client_approved') {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  if (row.extension_granted_at !== null) {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  // The one extension edge: at the deadline it is granted, one millisecond later it is refused.
  if (now.getTime() > row.due_at.getTime()) {
    throw new HttpError(409, 'deadline_passed');
  }
  const state = await loadState(user.practice_id, row.state_code);
  if (state === null) throw notFound();
  const extendedNominal = addDays(row.unextended_nominal_date, row.extension_days);
  const { dueDate } = computeCarry(extendedNominal, row.carry, state.holidays);
  const dueAt = deadlineOf(dueDate, state.zone);
  await pool.query(
    `update returns set extension_days_used = $1, extension_due_date_before = $2,
       extension_due_at_before = $3, extension_granted_at = $4, due_date = $5,
       nominal_due_date = $6, due_at = $7, version = version + 1, changed_by = $8
     where id = $9`,
    [row.extension_days, row.due_date, row.due_at, now, dueDate, extendedNominal, dueAt, user.display_name, row.id],
  );
  await syncReminders(row.id);
  const fresh = await getReturnById(row.id);
  if (fresh !== null) {
    announceStatus(user.practice_id, fresh);
    emitEvent(user.practice_id, {
      kind: 'extension_granted',
      return_id: row.id,
      client: row.client_name,
      state: row.state_code,
      period_label: periodLabel(row.period),
      due_date: dueDate,
    });
  }
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

app.post('/api/returns/:id/amend', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const body = req.body as Record<string, unknown>;
  await versionCheck(row, body);
  if (row.status !== 'filed' && row.status !== 'packeted') {
    throw new HttpError(409, 'illegal_status', { status: row.status });
  }
  const errors = amountErrors(body);
  const note = body.note;
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    errors.note = 'Keep the note to 500 characters or fewer.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  const sequence = (await pool.query('select count(*)::int as count from amendments where return_id = $1', [row.id])).rows[0].count + 1;
  await pool.query(
    `insert into amendments (id, return_id, at, by_name, note, original_gross, original_tax, amended_gross, amended_tax, sequence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      newId('amend'), row.id, now, user.display_name,
      typeof note === 'string' ? note : null,
      row.gross_sales ?? '0.00', row.tax_due ?? '0.00',
      body.gross_sales, body.tax_due, sequence,
    ],
  );
  await pool.query(
    `update returns set status = 'amended', gross_sales = $1, tax_due = $2,
       packet_state = 'pending', version = version + 1, changed_by = $3 where id = $4`,
    [body.gross_sales, body.tax_due, user.display_name, row.id],
  );
  const fresh = await getReturnById(row.id);
  if (fresh !== null) announceStatus(user.practice_id, fresh);
  await runWorkOnce(user.practice_id, now);
  res.json(await serializeReturn((await getReturnById(row.id))!, now));
}));

// ---------- reminders, packet, export, events, health ----------

app.get('/api/returns/:id/reminders', wrap(async (req, res) => {
  requireBookkeeper(req);
  const row = await openReturn(req, param(req, 'id'));
  const reminders = await pool.query(
    'select lead_days, scheduled_for, sent_at, status from reminders where return_id = $1 order by scheduled_for',
    [row.id],
  );
  res.json(reminders.rows.map((r) => ({
    lead_days: r.lead_days as number,
    scheduled_for: (r.scheduled_for as Date).toISOString(),
    sent_at: r.sent_at === null ? null : (r.sent_at as Date).toISOString(),
    status: r.status as 'pending' | 'sent',
  })));
}));

app.get('/api/returns/:id/packet', wrap(async (req, res) => {
  const row = await openReturn(req, param(req, 'id'));
  const revisionParam = req.query.revision;
  let revision: number;
  if (revisionParam === undefined) {
    revision = row.packet_revisions;
  } else {
    const parsed = Number(revisionParam);
    if (!Number.isInteger(parsed)) throw notFound();
    revision = parsed;
  }
  const stored = await pool.query(
    'select bytes from packets where return_id = $1 and revision = $2',
    [row.id, revision],
  );
  if (stored.rows.length === 0) {
    if (revisionParam !== undefined || row.packet_revisions === 0) {
      throw notFound();
    }
    throw new HttpError(409, 'packet_pending');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.send(stored.rows[0].bytes);
}));

const CSV_HEADER = 'client,state,period,status,overdue,due_at,zone,gross_sales,tax_due,rate,edition_effective_date';

function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

app.get('/api/year/:year/export.csv', wrap(async (req, res) => {
  const user = requireBookkeeper(req);
  const year = param(req, 'year');
  if (!YEAR_PARAM.test(year)) throw notFound();
  const practice = await currentPractice(user.practice_id);
  const now = practiceInstant(practice);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const rows = await listReturns(user.practice_id, { year, status, state }, now);
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.client_name,
        row.state_code,
        row.period,
        row.status,
        isRowOverdue(row, now) ? 'true' : 'false',
        row.due_at.toISOString(),
        row.zone,
        row.gross_sales ?? '',
        row.tax_due ?? '',
        row.rate,
        row.edition_effective_date,
      ]
        .map(csvField)
        .join(','),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="duefield-${year}.csv"`);
  res.send(lines.join('\r\n') + '\r\n');
}));

app.get('/api/events', wrap(async (req, res) => {
  const user = requireSession(req);
  sseHandler(user.practice_id, user.role === 'owner' ? user.client_id : null, res);
}));

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: mailUp() && pdfUp() ? 'ok' : 'unavailable' });
});

// ---------- grading ----------

function gradingKeyOk(req: Request): boolean {
  if (GRADING_KEY === '') return false;
  return req.headers['x-grading-key'] === GRADING_KEY;
}

app.post('/api/grading/fixture', wrap(async (req, res) => {
  if (!gradingKeyOk(req)) throw notFound();
  res.status(201).json(await buildFixture(req));
}));

app.post('/api/grading/clock', wrap(async (req, res) => {
  if (!gradingKeyOk(req)) throw notFound();
  const body = req.body as Record<string, unknown>;
  const practiceId = body.practice_id;
  if (typeof practiceId !== 'string') throw notFound();
  const practice = await getPractice(practiceId);
  if (practice === null) throw notFound();
  const nowValue = body.now;
  if (typeof nowValue !== 'string' || !DateTime.fromISO(nowValue, { zone: 'utc' }).isValid) {
    throw validation({ now: 'Send an instant like 2026-06-22T15:00:00.000Z.' });
  }
  await pool.query('update practices set clock_now = $1 where id = $2', [new Date(nowValue), practiceId]);
  const now = practiceNow(new Date(nowValue));
  await runWorkOnce(practiceId, now);
  emitEvent(practiceId, { kind: 'clock_changed', now: now.toISOString() });
  res.json({ now: now.toISOString() });
}));

async function buildFixture(req: Request): Promise<Record<string, unknown>> {
  const body = req.body as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const bookkeeper = (body.bookkeeper ?? {}) as Record<string, unknown>;
  const displayName = bookkeeper.display_name;
  const email = bookkeeper.email;
  const password = bookkeeper.password;
  const reminderHour = bookkeeper.reminder_hour ?? 9;
  if (typeof displayName !== 'string' || displayName.trim() === '') errors['bookkeeper.display_name'] = 'Enter your name.';
  if (!validEmail(email)) errors['bookkeeper.email'] = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) errors['bookkeeper.password'] = 'Use at least 8 characters.';
  if (typeof reminderHour !== 'number' || !Number.isInteger(reminderHour) || reminderHour < 6 || reminderHour > 21) {
    errors['bookkeeper.reminder_hour'] = 'Choose a whole hour from 6 to 21.';
  }
  let clockNow: Date | null = null;
  const nowValue = body.now;
  if (nowValue !== undefined) {
    if (typeof nowValue !== 'string' || !DateTime.fromISO(nowValue, { zone: 'utc' }).isValid) {
      errors.now = 'Send an instant like 2026-06-22T15:00:00.000Z.';
    } else {
      clockNow = new Date(nowValue);
    }
  }
  const states = (body.states ?? SEED_STATES.map((s) => ({
    code: s.code,
    name: s.name,
    zone: s.zone,
    holidays: s.holidays,
    editions: [{
      effective_date: '2020-01-01',
      due_day: s.due_day,
      carry: s.carry,
      rate: s.rate,
      extension_days: s.extension_days,
    }],
  }))) as { code: string; name: string; zone: string; holidays?: string[]; editions: Record<string, unknown>[] }[];
  if (!Array.isArray(states)) errors.states = 'Send states as an array.';
  const clients = (body.clients ?? []) as Record<string, unknown>[];
  if (!Array.isArray(clients)) errors.clients = 'Send clients as an array.';
  if (Object.keys(errors).length > 0) throw validation(errors);
  const existing = await getUserByEmail(email as string);
  if (existing !== null) throw validation({ 'bookkeeper.email': 'An account with this email already exists.' });

  const practiceId = newId('practice');
  await pool.query(
    'insert into practices (id, clock_now, reminder_hour) values ($1, $2, $3)',
    [practiceId, clockNow, reminderHour],
  );
  for (const state of states) {
    const holidays = Array.isArray(state.holidays) ? (state.holidays as string[]) : [];
    await pool.query(
      'insert into states (practice_id, code, name, zone, holidays) values ($1, $2, $3, $4, $5)',
      [practiceId, state.code, state.name, state.zone, holidays],
    );
    for (const edition of state.editions) {
      await pool.query(
        `insert into editions (practice_id, state_code, effective_date, due_day, carry, rate, extension_days)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [practiceId, state.code, edition.effective_date, edition.due_day, edition.carry, edition.rate, edition.extension_days],
      );
    }
  }
  const bookkeeperId = newId('user');
  await pool.query(
    `insert into users (id, practice_id, role, display_name, email, password_hash)
     values ($1, $2, 'bookkeeper', $3, $4, $5)`,
    [bookkeeperId, practiceId, (displayName as string).trim(), (email as string).toLowerCase(), hashPassword(password as string)],
  );
  const bookkeeperToken = newToken();
  await createSession(bookkeeperToken, bookkeeperId, SESSION_TTL);

  const now = practiceNow(clockNow);
  const clientMap: Record<string, { id: string; owner_session: string; registrations: Record<string, { id: string; returns: Record<string, string> }> }> = {};
  for (const clientSpec of clients) {
    const clientKey = String(clientSpec.key ?? '');
    const owner = (clientSpec.owner ?? {}) as Record<string, unknown>;
    const clientId = newId('client');
    const ownerId = newId('user');
    await pool.query('insert into clients (id, practice_id, name) values ($1, $2, $3)', [
      clientId, practiceId, clientSpec.name,
    ]);
    await pool.query(
      `insert into users (id, practice_id, role, display_name, email, password_hash, client_id)
       values ($1, $2, 'owner', $3, $4, $5, $6)`,
      [ownerId, practiceId, String(owner.display_name ?? '').trim(), String(owner.email ?? '').toLowerCase(), hashPassword(String(owner.password ?? '')), clientId],
    );
    const ownerToken = newToken();
    await createSession(ownerToken, ownerId, SESSION_TTL);
    const regMap: Record<string, { id: string; returns: Record<string, string> }> = {};
    for (const registration of (clientSpec.registrations ?? []) as Record<string, unknown>[]) {
      const registrationId = newId('reg');
      await pool.query(
        'insert into registrations (id, client_id, practice_id, state_code, frequency, first_period) values ($1, $2, $3, $4, $5, $6)',
        [registrationId, clientId, practiceId, registration.state, registration.frequency, registration.first_period],
      );
      const domainState = await loadState(practiceId, String(registration.state));
      if (domainState === null) continue;
      const frequency = registration.frequency as Frequency;
      const periods = generatedPeriods(frequency, String(registration.first_period));
      const overrides = new Map<string, Record<string, unknown>>(
        ((registration.returns ?? []) as Record<string, unknown>[]).map((r) => [String(r.period), r]),
      );
      const returnsMap: Record<string, string> = {};
      for (const period of periods) {
        const due = computeDue(domainState, period, frequency, null);
        const returnId = newId('ret');
        const spec = overrides.get(period) ?? {};
        const status = String(spec.status ?? 'not_started');
        let gross: string | null = typeof spec.gross_sales === 'string' ? spec.gross_sales : null;
        let tax: string | null = typeof spec.tax_due === 'string' ? spec.tax_due : null;
        if (status !== 'not_started') {
          gross = gross ?? '0.00';
          tax = tax ?? '0.00';
        } else {
          gross = null;
          tax = null;
        }
        const awaiting = status === 'prepared';
        const preparedAt = status === 'prepared' ? now : null;
        const filed = status === 'filed' || status === 'packeted';
        const packetState: 'none' | 'pending' | 'ready' = filed ? 'pending' : 'none';
        await pool.query(
          `insert into returns (id, practice_id, client_id, registration_id, state_code, frequency, period,
             status, version, gross_sales, tax_due, edition_effective_date, due_day, carry, rate, extension_days,
             unextended_nominal_date, nominal_due_date, due_date, due_at, packet_state, awaiting_approval,
             prepared_at, amounts_set, changed_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12, $13, $14, $15,
             $16, $16, $17, $18, $19, $20, $21, $22, $23)`,
          [
            returnId, practiceId, clientId, registrationId, String(registration.state),
            frequency, period, status, gross, tax,
            due.edition.effective_date, due.edition.due_day, due.edition.carry,
            due.edition.rate, due.edition.extension_days,
            due.unextended_nominal_date, due.due_date, due.due_at,
            packetState, awaiting, preparedAt, status !== 'not_started', (displayName as string).trim(),
          ],
        );
        if (status !== 'not_started' && status !== 'prepared') {
          await pool.query(
            `insert into approvals (id, return_id, action, by_user_id, by_name, at)
             values ($1, $2, 'approved', $3, $4, $5)`,
            [newId('appr'), returnId, ownerId, String(owner.display_name ?? ''), now],
          );
        }
        await syncReminders(returnId);
        returnsMap[period] = returnId;
      }
      regMap[String(registration.key ?? '')] = { id: registrationId, returns: returnsMap };
    }
    clientMap[clientKey] = { id: clientId, owner_session: ownerToken, registrations: regMap };
  }
  await runWorkOnce(practiceId, now);
  return {
    practice_id: practiceId,
    session: bookkeeperToken,
    clients: clientMap,
  };
}

// ---------- static pages and boundary ----------

const FRONTEND_DIR = path.resolve(process.cwd(), 'dist/frontend');
const BLOCKED_FILES = new Set([
  'run.json', 'package.json', 'package-lock.json',
]);

function safeStaticPath(urlPath: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(urlPath);
    } catch {
      return null;
    }
  })();
  if (decoded === null || decoded.includes('..') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s.startsWith('.'))) return null;
  if (segments.length > 0 && BLOCKED_FILES.has(segments[segments.length - 1])) return null;
  if (segments.length === 0) return path.join(FRONTEND_DIR, 'index.html');
  const resolved = path.resolve(FRONTEND_DIR, ...segments);
  if (!resolved.startsWith(FRONTEND_DIR + path.sep)) return null;
  return resolved;
}

function notFoundPage(res: Response): void {
  res.status(404).sendFile(path.join(FRONTEND_DIR, 'not-found.html'), (err) => {
    if (err !== undefined && err !== null) res.status(404).send('Return not found');
  });
}

app.use((req, res, _next) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const resolved = safeStaticPath(req.path);
  if (resolved === null) {
    notFoundPage(res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    notFoundPage(res);
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err === null && stat.isFile()) {
      res.sendFile(resolved);
      return;
    }
    // A page route falls back to the app; anything else is the not-found screen.
    if (req.path === '/' || isPageRoute(req.path)) {
      res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
      return;
    }
    notFoundPage(res);
  });
});

function isPageRoute(pagePath: string): boolean {
  if (pagePath === '/' || pagePath === '') return true;
  return /^\/(sign-up|sign-in|today|catalogue|month|year|clients|states|settings|home|returns)(\/|$)/.test(pagePath);
}

// The one error handler: the published error order ends here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    if (err.fieldErrors !== undefined) {
      res.status(err.status).json({ errors: err.fieldErrors });
      return;
    }
    if (err.code === 'conflict') {
      res.status(409).json({
        error: 'conflict',
        return: { version: err.extra?.version as number, status: err.extra?.status as string },
        changed_by: err.extra?.changed_by as string,
      });
      return;
    }
    if (err.code === 'illegal_status') {
      res.status(409).json({ error: 'illegal_status', status: err.extra?.status as string });
      return;
    }
    res.status(err.status).json({ error: err.code });
    return;
  }
  const entityTooLarge = typeof err === 'object' && err !== null && (err as { status?: number }).status === 413;
  if (entityTooLarge) {
    res.status(413).json({ error: 'too_large' });
    return;
  }
  const badJson = typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed';
  if (badJson) {
    res.status(400).json({ error: 'bad_json' });
    return;
  }
  const unsupported = typeof err === 'object' && err !== null
    && (err as { type?: string }).type === 'entity.unsupported.media.type';
  if (unsupported) {
    res.status(415).json({ error: 'unsupported_media_type' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

// ---------- boot ----------

let lastMailUp = true;
let lastPdfUp = true;
const overdueAnnounced = new Map<string, string>();

/** Push a deadline passing to open screens when the practice follows real time. */
async function checkRealTimeOverdue(): Promise<void> {
  const rows = await pool.query(
    `select r.id, r.practice_id, r.status, r.due_at, c.name as client_name, r.state_code, r.period
     from returns r
     join clients c on c.id = r.client_id
     join practices p on p.id = r.practice_id
     where r.status in ('not_started','prepared','client_approved')
       and r.due_at <= now() and p.clock_now is null`,
  );
  const seen = new Set<string>();
  for (const row of rows.rows) {
    seen.add(row.id);
    const key = `${row.practice_id}:${row.id}`;
    if (overdueAnnounced.has(key)) continue;
    overdueAnnounced.set(key, row.due_at.toISOString());
    emitEvent(row.practice_id, {
      kind: 'went_overdue',
      return_id: row.id,
      client: row.client_name,
      state: row.state_code,
      period_label: periodLabel(row.period),
    });
  }
  for (const key of overdueAnnounced.keys()) {
    if (!seen.has(key.split(':')[1])) overdueAnnounced.delete(key);
  }
}

async function tick(): Promise<void> {
  await probeServices();
  const mailChanged = mailUp() !== lastMailUp;
  const pdfChanged = pdfUp() !== lastPdfUp;
  lastMailUp = mailUp();
  lastPdfUp = pdfUp();
  if (mailChanged || pdfChanged) {
    const practices = await pool.query('select id from practices');
    for (const practice of practices.rows) {
      emitEvent(practice.id, { kind: 'service_state', mail_up: mailUp(), pdf_up: pdfUp() });
    }
  }
  const practices = await pool.query('select id, clock_now from practices');
  for (const practice of practices.rows) {
    const now = practiceNow(practice.clock_now);
    await runWorkOnce(practice.id, now);
  }
  await checkRealTimeOverdue();
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await probeServices();
  lastMailUp = mailUp();
  lastPdfUp = pdfUp();
  // Service checks and retries run every retry period; the overdue watch runs
  // often enough that a passing deadline reaches open screens within 2 seconds.
  setInterval(() => {
    void tick();
  }, SERVICE_RETRY_SECONDS * 1000);
  setInterval(() => {
    void checkRealTimeOverdue();
  }, 1000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Duefield listening on 0.0.0.0:${PORT}`);
  });
}

void main();
