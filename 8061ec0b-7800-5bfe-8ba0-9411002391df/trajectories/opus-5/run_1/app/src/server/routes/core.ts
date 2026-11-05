import { Router } from 'express';
import { now, storeToday } from '../clock';
import { pool, tx } from '../db';
import { ApiError, conflict, notFound, validationFailed } from '../errors';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  param,
  route,
  sessionCookie,
  sessionTokenOf,
} from '../http';
import { verifyPassword } from '../ids';
import { instrumentLabel, deliveryStatusWord } from '../../shared/labels';
import { formatStoreDate, isDateString, isoMillis } from '../../shared/time';
import {
  INSTRUMENT_TYPES,
  STRING_SIZES,
  type InstrumentStatus,
  type InstrumentType,
  type Size,
} from '../../shared/types';
import { availability } from '../domain/contracts';
import { allPriceLists, priceListById, priceListInForce, validatePriceList } from '../domain/pricing';
import { deliveryManifest, roster, schoolListing, schoolRow, schoolRows, upcomingDeliveryDays } from '../domain/schools';
import { deliveryNoticeBody } from '../domain/actions';
import { queueEmail } from '../services/mail';
import { randomId } from '../ids';
import { familyOverview } from '../domain/family';

export const coreRouter = Router();

coreRouter.post(
  '/session',
  route('anyone', async ({ body, res }) => {
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';
    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      role: 'owner' | 'parent' | 'director' | 'tech';
      family_id: string | null;
      school_id: string | null;
      password_hash: string;
    }>('select id, name, email, role, family_id, school_id, password_hash from users where lower(email) = $1', [email]);
    const user = rows[0];
    if (user === undefined || !verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, 'invalid_credentials', 'Email or password is wrong.');
    }
    const token = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return {
      body: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          family_id: user.family_id,
          school_id: user.school_id,
        },
      },
    };
  }),
);

coreRouter.get(
  '/me',
  route('signed-in', async ({ user }) => ({ body: { user } })),
);

coreRouter.delete(
  '/session',
  route('signed-in', async ({ req, res }) => {
    const token = sessionTokenOf(req);
    if (token !== undefined) await destroySession(token);
    res.setHeader('Set-Cookie', clearedSessionCookie());
    return undefined;
  }),
);

coreRouter.get(
  '/availability',
  route('signed-in', async () => ({ body: { items: await availability(pool) } })),
);

coreRouter.get(
  '/schools',
  route('signed-in', async () => {
    const at = now();
    const rows = await schoolRows(pool);
    return { body: { server_now: isoMillis(at), schools: rows.map((row) => schoolListing(row, at)) } };
  }),
);

coreRouter.get(
  '/price-lists/current',
  route('signed-in', async ({ req }) => {
    const on = req.query.on;
    if (on !== undefined && (typeof on !== 'string' || !isDateString(on))) {
      throw validationFailed({ on: 'Use a date as YYYY-MM-DD.' });
    }
    const date = typeof on === 'string' ? on : storeToday();
    const priceList = await priceListInForce(pool, date);
    if (priceList === null) throw notFound();
    return { body: { price_list: priceList } };
  }),
);

coreRouter.get(
  '/price-lists',
  route(['owner'], async () => ({ body: { price_lists: await allPriceLists(pool) } })),
);

coreRouter.post(
  '/price-lists',
  route(['owner'], async ({ body }) => {
    const draft = validatePriceList(body, storeToday());
    const at = now();
    const id = `PL-${draft.effective_date.replace(/-/g, '')}-${randomId('X').slice(2, 8)}`;
    await pool.query(
      'insert into price_lists (id, effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers) values ($1,$2,$3,null,$4,$5,$6)',
      [id, draft.effective_date, at, draft.tax_rate_bp, JSON.stringify(draft.items), JSON.stringify(draft.tiers)],
    );
    const stored = await priceListById(pool, id);
    if (stored === null) throw notFound();
    return { status: 201, body: { price_list: stored } };
  }),
);

coreRouter.post(
  '/price-lists/:id/withdraw',
  route(['owner'], async ({ req }) => {
    const id = param(req, 'id');
    const existing = await priceListById(pool, id);
    if (existing === null) throw notFound();
    if (existing.withdrawn_at !== null) {
      throw conflict('price_list_withdrawn', `${id} was already withdrawn.`);
    }
    if (existing.effective_date <= storeToday()) {
      throw conflict('price_list_in_force', `${id} is already in force and cannot be withdrawn.`);
    }
    await pool.query('update price_lists set withdrawn_at = $2 where id = $1', [id, now()]);
    const updated = await priceListById(pool, id);
    if (updated === null) throw notFound();
    return { body: { price_list: updated } };
  }),
);

interface InstrumentQueryRow {
  serial: string;
  instrument_type: InstrumentType;
  size: Size;
  model: string;
  status: InstrumentStatus;
  contract_id: string | null;
  school_name: string | null;
}

coreRouter.get(
  '/instruments',
  route(['owner', 'tech'], async () => {
    const { rows } = await pool.query<InstrumentQueryRow>(
      `select i.serial, i.instrument_type, i.size, i.model, i.status, c.id as contract_id, sch.name as school_name
         from instruments i
         left join lateral (
           select id, student_id from contracts
            where serial = i.serial and status in ('reserved','agreement_sent','signed','active','paid_off')
            order by created_at desc, seq desc limit 1
         ) c on true
         left join students s on s.id = c.student_id
         left join schools sch on sch.id = s.school_id
        order by i.serial`,
    );
    return {
      body: {
        instruments: rows.map((row, index) => ({
          index: index + 1,
          serial: row.serial,
          instrument_type: row.instrument_type,
          size: row.size,
          model: row.model,
          label: instrumentLabel(row.instrument_type, row.size),
          status: row.status,
          contract_id: row.contract_id,
          school_name: row.school_name,
        })),
      },
    };
  }),
);

coreRouter.post(
  '/instruments',
  route(['owner'], async ({ body }) => {
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const serial = typeof raw.serial === 'string' ? raw.serial.trim() : '';
    if (!/^[A-Z0-9-]{3,20}$/.test(serial)) {
      fields.serial = 'Use 3 to 20 capital letters, digits and hyphens.';
    }
    const type = raw.instrument_type;
    const typeValid = typeof type === 'string' && INSTRUMENT_TYPES.includes(type as InstrumentType);
    if (!typeValid) fields.instrument_type = 'Choose one of the five instruments.';
    const size = raw.size;
    const stringed = type === 'violin' || type === 'cello';
    if (!(typeValid && (stringed ? STRING_SIZES.includes(size as never) : size === 'full'))) {
      fields.size = 'Choose a size this instrument comes in.';
    }
    const model = typeof raw.model === 'string' ? raw.model.trim() : '';
    if (model.length < 1 || model.length > 80) fields.model = 'Name the model in 1 to 80 characters.';
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const { rows: existing } = await pool.query('select serial from instruments where serial = $1', [serial]);
    if (existing.length > 0) throw conflict('serial_taken', `Serial ${serial} is already in the fleet.`);
    await pool.query(
      "insert into instruments (serial, instrument_type, size, model, status) values ($1,$2,$3,$4,'available')",
      [serial, type, size, model],
    );
    return {
      status: 201,
      body: {
        instrument: {
          index: 0,
          serial,
          instrument_type: type,
          size,
          model,
          label: instrumentLabel(type as InstrumentType, size as Size),
          status: 'available',
          contract_id: null,
          school_name: null,
        },
      },
    };
  }),
);

coreRouter.get(
  '/families',
  route(['owner'], async () => {
    const { rows } = await pool.query<{
      id: string;
      parent_name: string;
      email: string;
      phone: string;
      address: string;
    }>('select id, parent_name, email, phone, address from families order by seed_order, id');
    const { rows: students } = await pool.query<{
      id: string;
      name: string;
      grade: number;
      school_id: string;
      family_id: string;
    }>('select id, name, grade, school_id, family_id from students order by name');
    return {
      body: {
        families: rows.map((family) => ({
          ...family,
          students: students
            .filter((student) => student.family_id === family.id)
            .map(({ id, name, grade, school_id }) => ({ id, name, grade, school_id })),
        })),
      },
    };
  }),
);

coreRouter.post(
  '/students',
  route(['owner'], async ({ body }) => {
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const familyId = typeof raw.family_id === 'string' ? raw.family_id : '';
    const schoolId = typeof raw.school_id === 'string' ? raw.school_id : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const grade = raw.grade;
    const { rows: families } = await pool.query('select id from families where id = $1', [familyId]);
    if (families.length === 0) fields.family_id = 'Choose one of the store families.';
    const { rows: schools } = await pool.query('select id from schools where id = $1', [schoolId]);
    if (schools.length === 0) fields.school_id = 'Choose one of the partner schools.';
    if (name.length < 1 || name.length > 80) fields.name = 'Name the student in 1 to 80 characters.';
    if (!(typeof grade === 'number' && Number.isInteger(grade) && grade >= 0 && grade <= 12)) {
      fields.grade = 'Enter a grade from 0 to 12.';
    }
    if (Object.keys(fields).length > 0) throw validationFailed(fields);
    const id = randomId('S');
    await pool.query(
      'insert into students (id, name, grade, school_id, family_id, created_at) values ($1,$2,$3,$4,$5,$6)',
      [id, name, grade, schoolId, familyId, now()],
    );
    return { status: 201, body: { student: { id, name, grade, school_id: schoolId, family_id: familyId } } };
  }),
);

coreRouter.get(
  '/family',
  route(['parent'], async ({ user }) => ({ body: await familyOverview(pool, user!.family_id ?? '') })),
);

async function rosterForCaller(schoolId: string, user: { role: string; school_id: string | null }) {
  if (user.role === 'director' && user.school_id !== schoolId) throw notFound();
  const school = await schoolRow(pool, schoolId);
  if (school === null) throw notFound();
  return roster(pool, school, now());
}

coreRouter.get(
  '/schools/:id/roster',
  route(['director', 'owner'], async ({ req, user }) => ({
    body: await rosterForCaller(param(req, 'id'), user!),
  })),
);

function csvCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

coreRouter.get(
  '/schools/:id/roster.csv',
  route(['director', 'owner'], async ({ req, user, res }) => {
    const schoolId = param(req, 'id');
    const data = await rosterForCaller(schoolId, user!);
    const header = 'Student,Grade,Instrument,Size,Serial,Delivery date,Delivery status';
    const lines = data.students.map((row) =>
      [
        csvCell(row.student_name),
        csvCell(String(row.grade)),
        csvCell(row.instrument_type === null || row.size === null ? '' : instrumentLabel(row.instrument_type, row.size)),
        csvCell(row.size ?? ''),
        csvCell(row.serial ?? ''),
        csvCell(row.delivery_date ?? ''),
        csvCell(deliveryStatusWord(row.delivery_status)),
      ].join(','),
    );
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="roster-${schoolId}.csv"`);
    res.send(`${[header, ...lines].join('\n')}\n`);
    return undefined;
  }),
);

coreRouter.post(
  '/schools/:id/delivery-notice',
  route(['owner'], async ({ req, body }) => {
    const schoolId = param(req, 'id');
    const school = await schoolRow(pool, schoolId);
    if (school === null) throw notFound();
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const date = raw.delivery_date;
    const at = now();
    const upcoming = upcomingDeliveryDays(school.delivery_weekday, at, 4).map((day) => day.date);
    if (typeof date !== 'string' || !upcoming.includes(date)) {
      throw validationFailed({ delivery_date: 'Pick one of this school\u2019s upcoming delivery days.' });
    }
    const manifest = await deliveryManifest(pool, schoolId, date);
    const { rows } = await pool.query<{ email: string }>(
      "select email from users where role = 'director' and school_id = $1 limit 1",
      [schoolId],
    );
    const recipient = rows[0]?.email;
    if (recipient === undefined) throw notFound();
    await tx(async (sql) => {
      await queueEmail(sql, {
        dedupeKey: `delivery-${randomId('N')}`,
        recipient,
        subject: `Delivery day ${formatStoreDate(date)} — ${school.name}`,
        body: deliveryNoticeBody(school.name, date, manifest),
      });
    });
    return {
      status: 202,
      body: { recipient, delivery_date: date, student_count: manifest.length },
    };
  }),
);
