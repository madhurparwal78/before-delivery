import express from 'express';
import { q, one, pool } from '../db.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import { doseState, parseFirstDose, kennelValid } from '../domain/ward.js';
import { settings } from '../settings.js';

export const router = express.Router();

const GROUP_ORDER: Record<string, number> = { overdue: 0, due: 1, upcoming: 2, given: 3, skipped: 4 };
const DOSE_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  due: 'Due',
  overdue: 'Overdue',
  given: 'Given',
  skipped: 'Skipped',
};

export async function boardTreatments(clinicId: string) {
  const now = clockNow();
  const r = await q(
    `select d.*, tr.name as treatment_name, tr.admission_id, tr.patient_id,
            p.name as patient_name, ad.kennel
     from doses d
     join treatments tr on tr.id = d.treatment_id
     join admissions ad on ad.id = tr.admission_id
     join patients p on p.id = tr.patient_id
     where tr.clinic_id = $1
     order by d.scheduled_at, d.id`,
    [clinicId]
  );
  const admissionLast = new Map<string, Date>();
  for (const row of r.rows) {
    if (row.status === 'given' || row.status === 'skipped') {
      const at = new Date(row.given_at ?? row.scheduled_at).getTime();
      const cur = admissionLast.get(row.admission_id);
      if (cur === undefined || at > cur) admissionLast.set(row.admission_id, new Date(at));
    }
  }
  const activeAdmissions = new Set<string>();
  const seenOpen = new Map<string, boolean>();
  for (const row of r.rows) {
    if (row.status === 'upcoming' || row.status === 'due' || row.status === 'overdue') {
      seenOpen.set(row.admission_id, true);
    }
  }
  for (const [admissionId, last] of admissionLast) {
    if (last.getTime() + settings.admissionLingerHours * 3600_000 > now.getTime()) {
      activeAdmissions.add(admissionId);
    }
  }
  for (const [admissionId, open] of seenOpen) {
    if (open) activeAdmissions.add(admissionId);
  }

  const notes = await q(
    `select n.*, u.name as author from treatment_notes n
     join treatments tr on tr.id = n.treatment_id
     left join users u on u.id = n.author
     where tr.clinic_id = $1 order by n.created_at`,
    [clinicId]
  );
  const notesByTreatment = new Map<string, any[]>();
  for (const note of notes.rows) {
    const list = notesByTreatment.get(note.treatment_id) ?? [];
    list.push({
      id: note.id,
      text: note.text,
      author: note.author,
      createdAt: new Date(note.created_at).toISOString(),
    });
    notesByTreatment.set(note.treatment_id, list);
  }

  const doses = r.rows
    .filter((row: any) => activeAdmissions.has(row.admission_id))
    .map((row: any) => {
      const scheduled = new Date(row.scheduled_at);
      let status = row.status;
      if (status === 'upcoming' || status === 'due' || status === 'overdue') {
        status = doseState(scheduled, now);
      }
      return {
        id: row.id,
        treatmentId: row.treatment_id,
        admissionId: row.admission_id,
        patientId: row.patient_id,
        patientName: row.patient_name,
        kennel: row.kennel,
        name: row.treatment_name,
        scheduledAt: scheduled.toISOString(),
        status,
        givenAt: row.given_at ? new Date(row.given_at).toISOString() : null,
        givenBy: row.given_by ?? null,
        skipReason: row.skip_reason ?? null,
        notes: notesByTreatment.get(row.treatment_id) ?? [],
      };
    });
  doses.sort((a: any, b: any) => {
    const g = GROUP_ORDER[a.status] - GROUP_ORDER[b.status];
    if (g !== 0) return g;
    if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt < b.scheduledAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return doses;
}

export async function boardBeacons(clinicId: string): Promise<any> {
  const now = clockNow();
  const doses = await boardTreatments(clinicId);
  let overdue = 0;
  let dueWithinHour = 0;
  for (const d of doses) {
    if (d.status === 'given' || d.status === 'skipped') continue;
    if (d.status === 'overdue') overdue += 1;
    else if (new Date(d.scheduledAt).getTime() <= now.getTime() + 3600_000) dueWithinHour += 1;
  }
  const waiting = await one(
    `select count(*)::int as c from appointments where clinic_id = $1 and status = 'checked-in'`,
    [clinicId]
  );
  return { waiting: waiting.c, overdue, dueWithinHour };
}

router.get('/ward/board', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const doses = await boardTreatments(user.clinicId);
  return {
    status: 200,
    body: {
      beacons: await boardBeacons(user.clinicId),
      treatments: doses,
      now: clockNow().toISOString(),
    },
  };
}));

router.get('/beacons', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  return { status: 200, body: { beacons: await boardBeacons(user.clinicId), now: clockNow().toISOString() } };
}));

router.post('/ward/admissions', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['nurse', 'vet', 'manager']);
  const { patientId, kennel, treatments } = req.body ?? {};
  if (typeof patientId !== 'string') throw validationError('patientId');
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [patientId, user.clinicId]
  );
  if (!patient) throw t('not_found');
  if (!kennelValid(kennel)) throw validationError('kennel');
  if (!Array.isArray(treatments) || treatments.length === 0) {
    throw validationError('treatments.0.name');
  }
  const parsed = treatments.map((tr: any, i: number) => {
    if (!tr || typeof tr.name !== 'string' || tr.name.trim() === '') {
      throw validationError(`treatments.${i}.name`);
    }
    const first = parseFirstDose(tr.firstAt);
    if (!first) throw notValid(`treatments.${i}.firstAt`);
    if (typeof tr.intervalHours !== 'number' || !Number.isInteger(tr.intervalHours) || tr.intervalHours < 1 || tr.intervalHours > 24) {
      throw notValid(`treatments.${i}.intervalHours`);
    }
    if (typeof tr.count !== 'number' || !Number.isInteger(tr.count) || tr.count < 1 || tr.count > 28) {
      throw notValid(`treatments.${i}.count`);
    }
    return { name: tr.name.trim(), firstAt: first, intervalHours: tr.intervalHours, count: tr.count };
  });

  const occupied = await q(
    `select distinct ad.kennel from admissions ad
     join treatments tr on tr.admission_id = ad.id
     join doses d on d.treatment_id = tr.id
     where tr.clinic_id = $1 and d.status in ('upcoming','due','overdue')`,
    [user.clinicId]
  );
  if (occupied.rows.some((row: any) => row.kennel === kennel)) {
    throw t('kennel_taken', { Kennel: kennel });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const admission = await client.query(
      `insert into admissions (clinic_id, patient_id, kennel) values ($1, $2, $3) returning id`,
      [user.clinicId, patientId, kennel]
    );
    const admissionId = admission.rows[0].id;
    const treatmentIds: string[] = [];
    for (const tr of parsed) {
      const trr = await client.query(
        `insert into treatments (clinic_id, admission_id, patient_id, name, first_at, interval_hours, dose_count)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [user.clinicId, admissionId, patientId, tr.name, tr.firstAt, tr.intervalHours, tr.count]
      );
      const treatmentId = trr.rows[0].id;
      treatmentIds.push(treatmentId);
      for (let k = 0; k < tr.count; k++) {
        const at = new Date(tr.firstAt.getTime() + k * tr.intervalHours * 3600_000);
        await client.query(
          `insert into doses (treatment_id, idx, scheduled_at) values ($1, $2, $3)`,
          [treatmentId, k, at]
        );
      }
    }
    await client.query('commit');
    bus.pushClinic(user.clinicId, 'ward', {});
    return { status: 201, body: { id: admissionId, treatmentIds } };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}));

async function loadDose(id: string, clinicId: string) {
  const row = await one(
    `select d.*, tr.name as treatment_name, tr.clinic_id, p.name as patient_name
     from doses d
     join treatments tr on tr.id = d.treatment_id
     join patients p on p.id = tr.patient_id
     where d.id = $1 and tr.clinic_id = $2`,
    [id, clinicId]
  );
  return row;
}

export function dosePayload(row: any) {
  const scheduled = new Date(row.scheduled_at);
  let status = row.status;
  if (status === 'upcoming' || status === 'due' || status === 'overdue') status = doseState(scheduled);
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    admissionId: row.admission_id,
    patientName: row.patient_name,
    name: row.treatment_name,
    scheduledAt: scheduled.toISOString(),
    status,
    givenAt: row.given_at ? new Date(row.given_at).toISOString() : null,
    givenBy: row.given_by ?? null,
    skipReason: row.skip_reason ?? null,
  };
}

async function publishWard(clinicId: string): Promise<void> {
  bus.pushClinic(clinicId, 'ward', {});
  bus.pushClinic(clinicId, 'beacons', {});
}

router.post('/treatments/:id/given', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['nurse', 'vet', 'manager']);
  const row = await loadDose(req.params.id, user.clinicId);
  if (!row) throw t('not_found');
  const subs = { Patient: row.patient_name, Treatment: row.treatment_name };
  if (row.status === 'given') throw t('already_given', subs);
  if (row.status === 'skipped') throw t('already_skipped', subs);
  const state = doseState(new Date(row.scheduled_at));
  if (state === 'upcoming') throw t('not_due', subs);
  await q(
    `update doses set status = 'given', given_at = $1, given_by = $2 where id = $3`,
    [clockNow(), user.userId, row.id]
  );
  await publishWard(user.clinicId);
  const updated = await loadDose(row.id, user.clinicId);
  return { status: 200, body: dosePayload(updated) };
}));

router.post('/treatments/:id/reopen', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['nurse', 'vet', 'manager']);
  const row = await loadDose(req.params.id, user.clinicId);
  if (!row) throw t('not_found');
  const subs = { Patient: row.patient_name, Treatment: row.treatment_name };
  if (row.status !== 'given' && row.status !== 'skipped') throw t('not_closed', subs);
  await q(`update doses set status = 'upcoming', given_at = null, given_by = null, skip_reason = null where id = $1`, [row.id]);
  await publishWard(user.clinicId);
  const updated = await loadDose(row.id, user.clinicId);
  return { status: 200, body: dosePayload(updated) };
}));

router.post('/treatments/:id/skip', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['nurse', 'vet', 'manager']);
  const row = await loadDose(req.params.id, user.clinicId);
  if (!row) throw t('not_found');
  const subs = { Patient: row.patient_name, Treatment: row.treatment_name };
  const { reason } = req.body ?? {};
  if (typeof reason !== 'string' || reason.trim() === '' || reason.trim().length > 200) {
    throw validationError('reason');
  }
  if (row.status === 'given') throw t('already_given', subs);
  if (row.status === 'skipped') throw t('already_skipped', subs);
  const state = doseState(new Date(row.scheduled_at));
  if (state === 'upcoming') throw t('not_due', subs);
  await q(`update doses set status = 'skipped', skip_reason = $1, given_at = $2 where id = $3`, [reason.trim(), clockNow(), row.id]);
  await publishWard(user.clinicId);
  const updated = await loadDose(row.id, user.clinicId);
  return { status: 200, body: dosePayload(updated) };
}));

router.post('/treatments/:id/notes', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['nurse', 'vet', 'manager']);
  const row = await loadDose(req.params.id, user.clinicId);
  if (!row) throw t('not_found');
  const { text } = req.body ?? {};
  if (typeof text !== 'string' || text.trim() === '') throw validationError('text');
  const r = await q(
    `insert into treatment_notes (treatment_id, text, author) values ($1, $2, $3) returning id, created_at`,
    [row.treatment_id, text, user.userId]
  );
  bus.pushClinic(user.clinicId, 'ward', {});
  return {
    status: 201,
    body: {
      id: r.rows[0].id,
      text,
      author: user.name,
      createdAt: new Date(r.rows[0].created_at).toISOString(),
    },
  };
}));

export default router;
