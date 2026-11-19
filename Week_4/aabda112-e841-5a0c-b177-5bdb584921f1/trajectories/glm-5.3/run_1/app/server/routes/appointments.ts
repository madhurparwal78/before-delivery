import express from 'express';
import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { currentUser, handler, requireRole } from '../core.js';
import * as bus from '../live.js';
import {
  getAppointment, slotFree, parseStart, checkClinicHours, checkSlotBoundary, checkMinutes,
  transitionFrom, transitionError, isLate, statusLabel,
} from '../domain/appointments.js';
import { clinicDateOf } from '../tz.js';

export const router = express.Router();

function serializeAppt(row: any) {
  const now = clockNow();
  const late = row.status === 'booked' && isLate(new Date(row.start_at), now);
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    species: row.species,
    vetId: row.vet_id,
    vetName: row.vet_name,
    roomId: row.room_id,
    roomName: row.room_name,
    start: new Date(row.start_at).toISOString(),
    end: new Date(row.start_at.getTime() + row.minutes * 60000).toISOString(),
    minutes: row.minutes,
    reason: row.reason,
    status: row.status,
    late,
  };
}

router.get('/appointments', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : clinicDateOf(clockNow());
  const r = await q(
    `select a.*, p.name as patient_name, p.species, u.name as vet_name, r.name as room_name
     from appointments a
     join patients p on p.id = a.patient_id
     join users u on u.id = a.vet_id
     join rooms r on r.id = a.room_id
     where a.clinic_id = $1 and a.start_at::date::text = $2
       and a.status in ('booked','checked-in','in-consult','completed')
     order by a.start_at`,
    [user.clinicId, date]
  );
  const now = clockNow();
  return {
    status: 200,
    body: {
      appointments: r.rows.map((row: any) => serializeAppt(row)),
      date,
      now: now.toISOString(),
    },
  };
}));

router.post('/appointments', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['front-desk', 'vet', 'manager']);
  const { patientId, vetId, roomId, start, reason } = req.body ?? {};
  const minutes = checkMinutes(req.body?.minutes);
  if (typeof patientId !== 'string') throw validationError('patientId');
  const patient = await one(
    `select id from patients where id = $1 and clinic_id = $2`,
    [patientId, user.clinicId]
  );
  if (!patient) throw t('not_found');
  const vet = await one(
    `select id from users where id = $1 and clinic_id = $2 and role = 'vet' and status = 'Active'`,
    [vetId, user.clinicId]
  );
  if (!vet) throw t('not_found');
  const room = await one(`select id from rooms where id = $1 and clinic_id = $2`, [roomId, user.clinicId]);
  if (!room) throw t('not_found');
  if (typeof reason !== 'string' || !['Consult', 'Vaccination', 'Surgery'].includes(reason)) throw notValid('reason');
  const startAt = parseStart(start);
  checkSlotBoundary(startAt);
  checkClinicHours(startAt, minutes);
  if (!(await slotFree(user.clinicId, vetId, roomId, startAt, minutes))) throw t('slot_taken');
  const r = await q(
    `insert into appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [user.clinicId, patientId, vetId, roomId, startAt, minutes, reason]
  );
  const appt = await getAppointment(r.rows[0].id, user.clinicId);
  bus.pushClinic(user.clinicId, 'appointments', { date: clinicDateOf(startAt) });
  return { status: 201, body: serializeAppt(appt) };
}));

router.patch('/appointments/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['front-desk', 'vet', 'manager']);
  const appt = await getAppointment(req.params.id, user.clinicId);
  if (!appt) throw t('not_found');
  const body = req.body ?? {};
  if (appt.status !== 'booked') throw transitionError(appt.status);
  const startAt = body.start !== undefined ? parseStart(body.start) : new Date(appt.start_at);
  const minutes = body.minutes !== undefined ? checkMinutes(body.minutes) : appt.minutes;
  const roomId = body.roomId !== undefined ? body.roomId : appt.room_id;
  const vetId = body.vetId !== undefined ? body.vetId : appt.vet_id;
  if (body.roomId !== undefined) {
    const room = await one(`select id from rooms where id = $1 and clinic_id = $2`, [roomId, user.clinicId]);
    if (!room) throw t('not_found');
  }
  if (body.vetId !== undefined) {
    const vet = await one(
      `select id from users where id = $1 and clinic_id = $2 and role = 'vet' and status = 'Active'`,
      [vetId, user.clinicId]
    );
    if (!vet) throw t('not_found');
  }
  if (body.start !== undefined) {
    checkSlotBoundary(startAt);
    checkClinicHours(startAt, minutes);
  }
  const changed = body.start !== undefined || body.minutes !== undefined || body.roomId !== undefined || body.vetId !== undefined;
  if (changed) {
    if (!(await slotFree(user.clinicId, vetId, roomId, startAt, minutes, appt.id))) throw t('slot_taken');
    await q(
      `update appointments set start_at = $1, minutes = $2, room_id = $3, vet_id = $4 where id = $5`,
      [startAt, minutes, roomId, vetId, appt.id]
    );
  }
  const updated = await getAppointment(appt.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'appointments', { date: clinicDateOf(startAt) });
  return { status: 200, body: serializeAppt(updated) };
}));

const TRANSITIONS: Record<string, { action: string; allowed: string[]; extraCheck?: (appt: any) => void }> = {
  'check-in': { action: 'check-in', allowed: ['front-desk', 'vet', 'manager'] },
  start: { action: 'start', allowed: ['front-desk', 'vet', 'manager'] },
  complete: { action: 'complete', allowed: ['vet', 'manager'] },
  'no-show': { action: 'no-show', allowed: ['front-desk', 'vet', 'manager'] },
};

function postTransition(kind: keyof typeof TRANSITIONS) {
  return handler(async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw t('unauthenticated');
    const rule = TRANSITIONS[kind];
    requireRole(user.role, rule.allowed);
    const appt = await getAppointment(req.params.id, user.clinicId);
    if (!appt) throw t('not_found');
    const next = transitionFrom(appt.status, rule.action);
    if (!next) throw transitionError(appt.status);
    if (kind === 'no-show' && clockNow().getTime() < new Date(appt.start_at).getTime()) {
      throw t('too_early');
    }
    if (kind === 'check-in') {
      await q(
        `update appointments set status = 'checked-in', checked_in_at = $1 where id = $2`,
        [clockNow(), appt.id]
      );
    } else {
      await q(`update appointments set status = $1 where id = $2`, [next, appt.id]);
    }
    const updated = await getAppointment(appt.id, user.clinicId);
    bus.pushClinic(user.clinicId, 'appointments', { date: clinicDateOf(new Date(updated.start_at)) });
    bus.pushClinic(user.clinicId, 'queue', {});
    bus.pushClinic(user.clinicId, 'beacons', {});
    return { status: 200, body: serializeAppt(updated) };
  });
}

router.post('/appointments/:id/check-in', postTransition('check-in'));
router.post('/appointments/:id/start', postTransition('start'));
router.post('/appointments/:id/complete', postTransition('complete'));
router.post('/appointments/:id/no-show', postTransition('no-show'));

router.delete('/appointments/:id', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['front-desk', 'vet', 'manager']);
  const appt = await getAppointment(req.params.id, user.clinicId);
  if (!appt) throw t('not_found');
  if (appt.status !== 'booked' && appt.status !== 'checked-in') throw transitionError(appt.status);
  const now = clockNow();
  await q(
    `update appointments set prev_status = status, status = 'cancelled', cancelled_at = $1,
     undo_until = $2 where id = $3`,
    [now, new Date(now.getTime() + settings.undoSeconds * 1000), appt.id]
  );
  bus.pushClinic(user.clinicId, 'appointments', { date: clinicDateOf(new Date(appt.start_at)) });
  bus.pushClinic(user.clinicId, 'queue', {});
  bus.pushClinic(user.clinicId, 'beacons', {});
  return {
    status: 200,
    body: {
      id: appt.id,
      status: 'cancelled',
      undoUntil: new Date(now.getTime() + settings.undoSeconds * 1000).toISOString(),
      now: now.toISOString(),
    },
  };
}));

router.post('/appointments/:id/restore', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  requireRole(user.role, ['front-desk', 'vet', 'manager']);
  const appt = await getAppointment(req.params.id, user.clinicId);
  if (!appt) throw t('not_found');
  if (appt.status !== 'cancelled') throw transitionError(appt.status);
  const now = clockNow();
  if (appt.undo_until === null || now.getTime() > new Date(appt.undo_until).getTime()) {
    throw t('undo_expired');
  }
  if (!(await slotFree(user.clinicId, appt.vet_id, appt.room_id, new Date(appt.start_at), appt.minutes, appt.id))) {
    throw t('slot_taken');
  }
  await q(`update appointments set status = $1, prev_status = null, cancelled_at = null, undo_until = null where id = $2`, [
    appt.prev_status ?? 'booked',
    appt.id,
  ]);
  const updated = await getAppointment(appt.id, user.clinicId);
  bus.pushClinic(user.clinicId, 'appointments', { date: clinicDateOf(new Date(appt.start_at)) });
  bus.pushClinic(user.clinicId, 'queue', {});
  return { status: 200, body: serializeAppt(updated) };
}));

router.get('/queue', handler(async (req, res) => {
  const user = await currentUser(req);
  if (!user) throw t('unauthenticated');
  const now = clockNow();
  const r = await q(
    `select a.id, a.checked_in_at, a.start_at, p.name as patient_name, p.species, u.name as vet_name,
            p.id as patient_id
     from appointments a
     join patients p on p.id = a.patient_id
     join users u on u.id = a.vet_id
     where a.clinic_id = $1 and a.status = 'checked-in'
     order by a.checked_in_at, a.id`,
    [user.clinicId]
  );
  const queue = r.rows.map((row: any) => {
    const checkedIn = new Date(row.checked_in_at);
    const start = new Date(row.start_at);
    const lateBy = checkedIn.getTime() - start.getTime();
    return {
      appointmentId: row.id,
      patientId: row.patient_id,
      patientName: row.patient_name,
      species: row.species,
      vetName: row.vet_name,
      checkedInAt: checkedIn.toISOString(),
      waitingMinutes: Math.floor((now.getTime() - checkedIn.getTime()) / 60000),
      lateByMinutes:
        lateBy >= settings.lateMinutes * 60000 ? Math.floor(lateBy / 60000) : null,
    };
  });
  return { status: 200, body: { queue, now: now.toISOString() } };
}));

export default router;
