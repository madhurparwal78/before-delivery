import express from 'express';
import { q, one } from '../db.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { clinicDateOf, clinicToUtc } from '../tz.js';
import { settings } from '../settings.js';

export const router = express.Router();

const SPECIES = ['dog', 'cat', 'rabbit', 'other'];

export async function patientStatus(clinicId: string, patientId: string): Promise<string | null> {
  const ward = await one(
    `select d.id from doses d
     join treatments tr on tr.id = d.treatment_id
     join admissions a on a.id = tr.admission_id
     where tr.patient_id = $1 and tr.clinic_id = $2 and d.status in ('upcoming','due','overdue')
     limit 1`,
    [patientId, clinicId]
  );
  if (ward) return 'In ward';
  const waiting = await one(
    `select id from appointments where patient_id = $1 and clinic_id = $2 and status = 'checked-in' limit 1`,
    [patientId, clinicId]
  );
  if (waiting) return 'Waiting';
  const consult = await one(
    `select id from appointments where patient_id = $1 and clinic_id = $2 and status = 'in-consult' limit 1`,
    [patientId, clinicId]
  );
  if (consult) return 'In consult';
  return null;
}

router.get('/patients', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const searchText = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const r = await q(
    `select p.*, c.name as client_name from patients p
     join clients c on c.id = p.client_id
     where p.clinic_id = $1
       and ($2 = '' or p.name ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%')
     order by p.name`,
    [user.clinicId, searchText]
  );
  const patients = [];
  for (const row of r.rows) {
    patients.push({
      id: row.id,
      name: row.name,
      species: row.species,
      clientName: row.client_name,
      weightGrams: row.weight_grams,
      photoFileId: row.photo_file_id,
      status: await patientStatus(user.clinicId, row.id),
    });
  }
  return { status: 200, body: { patients } };
}));

router.get('/patients/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const row = await one(
    `select p.*, c.name as client_name from patients p
     join clients c on c.id = p.client_id
     where p.id = $1 and p.clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!row) throw t('not_found');
  const weights = await q(
    `select recorded_on::text as recorded_on, grams from patient_weights
     where patient_id = $1 order by recorded_on`,
    [row.id]
  );
  const vaccinations = await q(
    `select id, vaccine, due_date::text as due_date, reminder from vaccinations
     where patient_id = $1 order by due_date`,
    [row.id]
  );
  const history = await q(
    `select a.id, a.start_at, a.reason, u.name as vet_name from appointments a
     join users u on u.id = a.vet_id
     where a.patient_id = $1 and a.clinic_id = $2 and a.status = 'completed'
     order by a.start_at desc`,
    [row.id, user.clinicId]
  );
  const historyOut = [];
  for (const h of history.rows) {
    const note = await one(
      `select n from note_paragraphs where appointment_id = $1 order by n limit 2`,
      [h.id]
    );
    const paras = await q(
      `select text from note_paragraphs where appointment_id = $1 order by n`,
      [h.id]
    );
    const preview = paras.rows.map((p: any) => p.text).join(' ').slice(0, 160);
    historyOut.push({
      appointmentId: h.id,
      start: new Date(h.start_at).toISOString(),
      reason: h.reason,
      vetName: h.vet_name,
      notePreview: preview,
    });
  }
  return {
    status: 200,
    body: {
      id: row.id,
      name: row.name,
      species: row.species,
      clientName: row.client_name,
      weightGrams: row.weight_grams,
      photoFileId: row.photo_file_id,
      status: await patientStatus(user.clinicId, row.id),
      weights: weights.rows.map((w: any) => ({ recordedOn: w.recorded_on, grams: w.grams })),
      vaccinations: vaccinations.rows.map((v: any) => ({
        id: v.id,
        vaccine: v.vaccine,
        dueDate: v.due_date,
        reminder: v.reminder,
      })),
      history: historyOut,
    },
  };
}));

router.post('/patients/:id/weights', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['vet', 'nurse', 'manager']);
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!patient) throw t('not_found');
  const { grams } = req.body ?? {};
  if (typeof grams !== 'number' || !Number.isInteger(grams) || grams < 1 || grams > 200000) {
    throw notValid('grams');
  }
  await q(
    `insert into patient_weights (patient_id, recorded_on, grams) values ($1, $2, $3)`,
    [req.params.id, clinicDateOf(clockNow()), grams]
  );
  await q(`update patients set weight_grams = $1 where id = $2`, [grams, req.params.id]);
  bus.pushClinic(user.clinicId, 'patients', {});
  return { status: 201, body: { grams } };
}));

router.post('/patients/:id/vaccinations', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['vet', 'manager']);
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [req.params.id, user.clinicId]
  );
  if (!patient) throw t('not_found');
  const { vaccine, dueDate } = req.body ?? {};
  if (typeof vaccine !== 'string' || vaccine.trim() === '') throw validationError('vaccine');
  if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw notValid('dueDate');
  const dupe = await one(
    `select id from vaccinations where patient_id = $1 and vaccine = $2 and due_date = $3`,
    [req.params.id, vaccine.trim(), dueDate]
  );
  if (dupe) throw t('duplicate_vaccination');
  const now = clockNow();
  const today = clinicDateOf(now);
  const sendMoment = reminderSendMoment(dueDate);
  let reminder = 'Scheduled';
  if (sendMoment && now >= sendMoment) reminder = 'Missed';
  if (dueDate <= today) reminder = 'Missed';
  const r = await q(
    `insert into vaccinations (clinic_id, patient_id, vaccine, due_date, reminder)
     values ($1, $2, $3, $4, $5) returning id`,
    [user.clinicId, req.params.id, vaccine.trim(), dueDate, reminder]
  );
  bus.pushClinic(user.clinicId, 'patients', {});
  return { status: 201, body: { id: r.rows[0].id, vaccine: vaccine.trim(), dueDate, reminder } };
}));

// The one place that decides the reminder send moment.
export function reminderSendMoment(dueDateInput: string | Date): Date | null {
  const dueDate: string =
    dueDateInput instanceof Date ? dueDateInput.toISOString().slice(0, 10) : String(dueDateInput);
  const [y, m, d] = dueDate.split('-').map(Number);
  const sendDayMs = Date.UTC(y, m - 1, d) - settings.reminderLeadDays * 86400000;
  const sendDay = new Date(sendDayMs);
  const dayStr = `${sendDay.getUTCFullYear()}-${String(sendDay.getUTCMonth() + 1).padStart(2, '0')}-${String(sendDay.getUTCDate()).padStart(2, '0')}`;
  return clinicToUtc(
    Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)), Number(dayStr.slice(8, 10)),
    settings.reminderHour, 0, true
  );
}

router.get('/rooms', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const r = await q(
    `select id, name from rooms where clinic_id = $1 order by position`,
    [user.clinicId]
  );
  return { status: 200, body: { rooms: r.rows } };
}));

router.get('/vets', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const r = await q(
    `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
    [user.clinicId]
  );
  return { status: 200, body: { vets: r.rows } };
}));

router.get('/clients', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const r = await q(
    `select c.id, c.name, coalesce(
       json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name) filter (where p.id is not null), '[]'
     ) as patients
     from clients c left join patients p on p.client_id = c.id
     where c.clinic_id = $1 group by c.id, c.name order by c.name`,
    [user.clinicId]
  );
  return { status: 200, body: { clients: r.rows.map((row: any) => ({ ...row, patients: row.patients })) } };
}));

export default router;
