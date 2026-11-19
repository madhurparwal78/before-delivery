import { deflateSync, crc32 } from 'node:zlib';
import { APPOINTMENT_REASONS, ROLES, SPECIES } from '../shared/domain.js';
import { now } from './clock.js';
import { type Db, one } from './db.js';
import { AppError, invalid } from './errors.js';
import { hashPassword } from './http.js';
import { applyPayment, addLine, createInvoice, loadInvoice } from './invoices.js';
import { createLoginLink } from './accounts.js';
import { storeFile } from './patients.js';
import { createItem } from './stock.js';
import { admit, type TreatmentPlan } from './ward.js';
import { reminderAtCreation } from './reminders.js';
import { lateByMinutes } from './appointments.js';

const DEMO_PASSWORD = 'roundbook-demo-1';

type Item = Record<string, any>;
type Refs = Record<string, string>;

interface SeedResult {
  clinics: Refs;
  users: Record<string, { id: string; login_url: string }>;
  rooms: Refs;
  clients: Refs;
  patients: Refs;
  appointments: Refs;
  hospitalised: Refs;
  treatments: Record<string, string[]>;
  stock: Refs;
  invoices: Refs;
}

/** A small generated profile photo: a solid PNG, drawn here so no image file ships. */
function profilePhoto(seed: string): Buffer {
  const size = 48;
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 3, 0);
  const [r, g, b] = [[220, 238, 232], [235, 211, 224], [205, 243, 253]][hue];
  const pixel = (x: number, y: number) => (Math.hypot(x - size / 2, y - size / 2 - 4) < size / 3 ? [Math.round(r * 0.55), Math.round(g * 0.55), Math.round(b * 0.55)] : [r, g, b]);
  const raw = Buffer.concat(
    Array.from({ length: size }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, (_, x) => pixel(x, y)).flat())])),
  );
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const list = (body: Item, key: string): Item[] => {
  const value = body[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(key, key);
  return value;
};

/** Every reference must resolve before anything is written; a bad one names the referring key, e.g. `patients.2.client`. */
function check(body: Item): void {
  const refs = (key: string) => new Set(list(body, key).map((i) => i.ref));
  const known: Record<string, Set<string>> = {
    clinics: refs('clinics'),
    users: refs('users'),
    rooms: refs('rooms'),
    clients: refs('clients'),
    patients: refs('patients'),
    stock: refs('stock'),
    hospitalised: refs('hospitalised'),
  };
  const need = (key: string, i: number, field: string, target: string, value: unknown) => {
    if (typeof value !== 'string' || !known[target].has(value)) throw invalid(`${key}.${i}.${field}`, field);
  };
  list(body, 'users').forEach((u, i) => {
    need('users', i, 'clinic', 'clinics', u.clinic);
    if (!ROLES.includes(u.role)) throw invalid(`users.${i}.role`, 'role');
  });
  list(body, 'rooms').forEach((r, i) => need('rooms', i, 'clinic', 'clinics', r.clinic));
  list(body, 'clients').forEach((c, i) => need('clients', i, 'clinic', 'clinics', c.clinic));
  list(body, 'patients').forEach((p, i) => {
    need('patients', i, 'clinic', 'clinics', p.clinic);
    need('patients', i, 'client', 'clients', p.client);
    if (!SPECIES.includes(p.species)) throw invalid(`patients.${i}.species`, 'species');
  });
  list(body, 'appointments').forEach((a, i) => {
    need('appointments', i, 'clinic', 'clinics', a.clinic);
    need('appointments', i, 'patient', 'patients', a.patient);
    need('appointments', i, 'vet', 'users', a.vet);
    need('appointments', i, 'room', 'rooms', a.room);
    if (!APPOINTMENT_REASONS.includes(a.reason)) throw invalid(`appointments.${i}.reason`, 'reason');
    if (!['booked', 'checked-in', 'in-consult', 'completed', 'no-show'].includes(a.status)) throw invalid(`appointments.${i}.status`, 'status');
    if (Number.isNaN(new Date(a.start).getTime())) throw invalid(`appointments.${i}.start`, 'start');
  });
  list(body, 'hospitalised').forEach((h, i) => {
    need('hospitalised', i, 'patient', 'patients', h.patient);
    (h.treatments ?? []).forEach((t: Item, k: number) => {
      if (Number.isNaN(new Date(t.firstAt).getTime())) throw invalid(`hospitalised.${i}.treatments.${k}.firstAt`, 'firstAt');
    });
  });
  list(body, 'stock').forEach((s, i) => need('stock', i, 'clinic', 'clinics', s.clinic));
  list(body, 'invoices').forEach((v, i) => {
    need('invoices', i, 'clinic', 'clinics', v.clinic);
    need('invoices', i, 'patient', 'patients', v.patient);
    (v.lines ?? []).forEach((l: Item, k: number) => need('invoices', i, `lines.${k}.stock`, 'stock', l.stock));
    (v.payments ?? []).forEach((p: Item, k: number) => {
      if (p.by !== undefined) need('invoices', i, `payments.${k}.by`, 'users', p.by);
    });
  });
}

/** Creates one whole scenario. Nothing is deleted; refs are local to the call. */
export async function seedWorld(db: Db, body: Item, origin: string): Promise<SeedResult> {
  check(body);
  const out: SeedResult = { clinics: {}, users: {}, rooms: {}, clients: {}, patients: {}, appointments: {}, hospitalised: {}, treatments: {}, stock: {}, invoices: {} };
  const at = now();
  for (const c of list(body, 'clinics')) {
    if (await one(db, 'SELECT 1 FROM clinics WHERE slug = $1', [c.slug])) throw new AppError('validation_failed', 'slug is not valid.', 'slug');
    out.clinics[c.ref] = (await one<{ id: string }>(db, 'INSERT INTO clinics (name, slug) VALUES ($1, $2) RETURNING id', [c.name, c.slug]))!.id;
  }
  const hashes = await Promise.all(list(body, 'users').map(() => hashPassword(DEMO_PASSWORD)));
  for (const [i, u] of list(body, 'users').entries()) {
    const id = (await one<{ id: string }>(
      db,
      'INSERT INTO users (clinic_id, name, email, role, status, password_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [out.clinics[u.clinic], u.name, u.email, u.role, 'Active', hashes[i]],
    ))!.id;
    out.users[u.ref] = { id, login_url: `${origin}/auth/link/${await createLoginLink(db, id)}` };
  }
  for (const r of list(body, 'rooms')) {
    out.rooms[r.ref] = (await one<{ id: string }>(db, 'INSERT INTO rooms (clinic_id, name) VALUES ($1, $2) RETURNING id', [out.clinics[r.clinic], r.name]))!.id;
  }
  for (const c of list(body, 'clients')) {
    out.clients[c.ref] = (await one<{ id: string }>(db, 'INSERT INTO clients (clinic_id, name, email) VALUES ($1, $2, $3) RETURNING id', [out.clinics[c.clinic], c.name, c.email]))!.id;
  }
  for (const p of list(body, 'patients')) {
    const clinicId = out.clinics[p.clinic];
    const id = (await one<{ id: string }>(
      db,
      'INSERT INTO patients (clinic_id, client_id, name, species, weight_grams) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [clinicId, out.clients[p.client], p.name, p.species, p.weightGrams ?? null],
    ))!.id;
    out.patients[p.ref] = id;
    for (const v of p.vaccinations ?? []) {
      await db.query('INSERT INTO vaccinations (patient_id, vaccine, due_date, reminder) VALUES ($1, $2, $3, $4)', [id, v.vaccine, v.dueDate, reminderAtCreation(v.dueDate, at)]);
    }
    for (const w of p.weights ?? []) await db.query('INSERT INTO weights (patient_id, recorded_on, grams) VALUES ($1, $2, $3)', [id, w.recordedOn, w.grams]);
    if (p.photo === true) {
      await storeFile(db, { clinicId, patientId: id, appointmentId: null, name: `${p.name}.png`, kind: 'profile', bytes: profilePhoto(p.name), contentType: 'image/png' });
    }
  }
  for (const s of list(body, 'stock')) {
    const batches = s.batches?.length ? s.batches : [{ batch: 'OPENING', expiresOn: '2099-12-31', quantity: s.onHand }];
    out.stock[s.ref] = await createItem(db, out.clinics[s.clinic], { name: s.name, reorderPoint: s.reorderPoint, unitPricePence: s.unitPricePence, batches }, null);
  }
  for (const a of list(body, 'appointments')) {
    const start = new Date(a.start);
    const checkedIn = a.status === 'checked-in' ? new Date(a.checkedInAt ?? at) : a.checkedInAt ? new Date(a.checkedInAt) : null;
    const minutes = a.minutes ?? 15;
    const lateBy = checkedIn ? lateByMinutes(start, checkedIn) : null;
    out.appointments[a.ref] = (await one<{ id: string }>(
      db,
      `INSERT INTO appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason, status, checked_in_at, late_by_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [out.clinics[a.clinic], out.patients[a.patient], out.users[a.vet].id, out.rooms[a.room], start, minutes, a.reason, a.status, checkedIn, lateBy],
    ))!.id;
  }
  for (const h of list(body, 'hospitalised')) {
    const plans: TreatmentPlan[] = (h.treatments ?? []).map((t: Item) => ({ name: t.name, firstAt: new Date(t.firstAt), intervalHours: t.intervalHours, count: t.count }));
    const clinicRow = (await one<{ clinic_id: string }>(db, 'SELECT clinic_id FROM patients WHERE id = $1', [out.patients[h.patient]]))!;
    const made = await admit(db, clinicRow.clinic_id, out.patients[h.patient], h.kennel, plans, (p) => h.treatments[p].givenDoses ?? [], at);
    out.hospitalised[h.ref] = made.id;
    out.treatments[h.ref] = made.treatmentIds.flat();
  }
  for (const v of list(body, 'invoices')) {
    const clinicId = out.clinics[v.clinic];
    const authorRef = list(body, 'users').find((u) => u.clinic === v.clinic && (u.role === 'front-desk' || u.role === 'manager'))?.ref;
    const author = out.users[authorRef].id;
    const id = await createInvoice(db, clinicId, out.patients[v.patient], null);
    out.invoices[v.ref] = id;
    await db.query('UPDATE invoices SET discount_percent = $2 WHERE id = $1', [id, v.discountPercent ?? 0]);
    for (const l of v.lines ?? []) {
      const item = (await one<{ id: string; name: string; unit_price_pence: number }>(db, 'SELECT id, name, unit_price_pence FROM stock_items WHERE id = $1', [out.stock[l.stock]]))!;
      await addLine(db, clinicId, id, item, l.quantity, author);
    }
    if (v.status === 'issued' || (v.payments ?? []).length > 0) await db.query(`UPDATE invoices SET status = 'issued' WHERE id = $1`, [id]);
    for (const p of v.payments ?? []) {
      await applyPayment(db, await loadInvoice(db, clinicId, id), p.pence, p.by ? out.users[p.by].id : author, at);
    }
  }
  return out;
}

