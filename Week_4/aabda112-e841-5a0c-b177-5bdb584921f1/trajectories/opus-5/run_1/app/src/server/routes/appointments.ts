import { Router } from 'express';
import { CLINIC_CLOSE_MINUTE, CLINIC_OPEN_MINUTE, settings } from '../config';
import {
  clinicToday,
  endOfClinicDate,
  instantOfSlot,
  isClinicDate,
  serverNow,
  startOfClinicDate,
} from '../clock';
import { newId, one, query, transaction, type Tx } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, findPatient, ok, requireString, route } from '../http';
import { requireActor, requireCapability } from '../auth';
import { publish } from '../live';
import {
  APPOINTMENT_SELECT,
  assertMovable,
  assertSlotFree,
  assertTransition,
  assertWithinClinicHours,
  isLate,
  lateByMinutes,
  lockClinicBookings,
  REASONS,
  STATUS_LABELS,
  toApiAppointment,
  validateStartAndLength,
  waitingMinutes,
  type AppointmentStatus,
  type AppointmentView,
} from '../domain/appointments';

export const appointmentRouter = Router();

async function loadAppointment(tx: Tx, id: unknown, clinicId: string): Promise<AppointmentView> {
  if (typeof id !== 'string') throw new AppError('not_found');
  const row = await tx.one<AppointmentView>(
    `${APPOINTMENT_SELECT} where a.id = $1 and a.clinic_id = $2`,
    [id, clinicId],
  );
  if (!row) throw new AppError('not_found');
  return row;
}

function publishCalendar(clinicId: string): void {
  publish(clinicId, { kind: 'changed', topics: ['calendar', 'queue', 'beacons', 'patients'] });
}

appointmentRouter.get(
  '/api/appointments',
  route(async (request) => {
    const actor = await requireActor(request);
    const date = typeof request.query.date === 'string' && request.query.date ? request.query.date : clinicToday();
    if (!isClinicDate(date)) throw invalid('date');
    const from = new Date(startOfClinicDate(date)).toISOString();
    const to = new Date(endOfClinicDate(date)).toISOString();
    const rows = await query<AppointmentView>(
      `${APPOINTMENT_SELECT}
        where a.clinic_id = $1 and a.start_at >= $2 and a.start_at < $3
          and a.status = any($4)
        order by a.start_at, r.sort, a.seq`,
      [actor.clinicId, from, to, ['booked', 'checked-in', 'in-consult', 'completed']],
    );
    const now = serverNow();
    return ok({
      date,
      now: new Date(now).toISOString(),
      slots: daySlots(date),
      appointments: rows.map((row) => toApiAppointment(row, now)),
    });
  }),
);

/** Slot boundaries of a clinic date, so the browser never works out an instant. */
function daySlots(date: string): { minuteOfDay: number; label: string; start: string }[] {
  const slots: { minuteOfDay: number; label: string; start: string }[] = [];
  for (
    let minute = CLINIC_OPEN_MINUTE;
    minute + settings.slotMinutes <= CLINIC_CLOSE_MINUTE;
    minute += settings.slotMinutes
  ) {
    const start = instantOfSlot(date, minute);
    if (start === null) continue;
    slots.push({
      minuteOfDay: minute,
      label: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      start: new Date(start).toISOString(),
    });
  }
  return slots;
}

appointmentRouter.post(
  '/api/appointments',
  route(async (request) => {
    const actor = await requireActor(request);
    const input = body(request);
    const patient = await findPatient(input.patientId, actor.clinicId);
    const vet = await one<{ id: string }>(
      `select id from users where id = $1 and clinic_id = $2 and status = 'Active'`,
      [typeof input.vetId === 'string' ? input.vetId : '', actor.clinicId],
    );
    if (!vet) throw new AppError('not_found');
    const room = await one<{ id: string }>('select id from rooms where id = $1 and clinic_id = $2', [
      typeof input.roomId === 'string' ? input.roomId : '',
      actor.clinicId,
    ]);
    if (!room) throw new AppError('not_found');
    requireCapability(actor, 'appointment.manage');
    const reason = input.reason === undefined ? 'Consult' : input.reason;
    if (!REASONS.includes(reason as never)) throw invalid('reason');
    const { start, minutes } = validateStartAndLength(input.start, input.minutes);

    const appointment = await transaction(async (tx) => {
      await lockClinicBookings(tx, actor.clinicId);
      const end = start + minutes * 60_000;
      await assertSlotFree(tx, {
        clinicId: actor.clinicId,
        vetId: vet.id,
        roomId: room.id,
        start,
        end,
      });
      const id = newId();
      await tx.query(
        `insert into appointments
           (id, clinic_id, patient_id, vet_id, room_id, start_at, end_at, reason, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'booked')`,
        [
          id,
          actor.clinicId,
          patient.id,
          vet.id,
          room.id,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
          reason,
        ],
      );
      return loadAppointment(tx, id, actor.clinicId);
    });
    publishCalendar(actor.clinicId);
    return created(toApiAppointment(appointment));
  }),
);

appointmentRouter.patch(
  '/api/appointments/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const input = body(request);
    const existing = await transaction((tx) => loadAppointment(tx, request.params.id, actor.clinicId));
    let vetId = existing.vet_id;
    if (input.vetId !== undefined) {
      const vet = await one<{ id: string }>(
        `select id from users where id = $1 and clinic_id = $2 and status = 'Active'`,
        [typeof input.vetId === 'string' ? input.vetId : '', actor.clinicId],
      );
      if (!vet) throw new AppError('not_found');
      vetId = vet.id;
    }
    let roomId = existing.room_id;
    if (input.roomId !== undefined) {
      const room = await one<{ id: string }>(
        'select id from rooms where id = $1 and clinic_id = $2',
        [typeof input.roomId === 'string' ? input.roomId : '', actor.clinicId],
      );
      if (!room) throw new AppError('not_found');
      roomId = room.id;
    }
    requireCapability(actor, 'appointment.manage');
    assertMovable(existing.status);

    let start = existing.start_at.getTime();
    let minutes = Math.round((existing.end_at.getTime() - start) / 60_000);
    if (input.start !== undefined) {
      if (typeof input.start !== 'string' || Number.isNaN(Date.parse(input.start))) {
        throw invalid('start');
      }
      start = Date.parse(input.start);
    }
    if (input.minutes !== undefined) {
      if (
        typeof input.minutes !== 'number' ||
        !Number.isInteger(input.minutes) ||
        input.minutes < settings.slotMinutes ||
        input.minutes > 120 ||
        input.minutes % settings.slotMinutes !== 0
      ) {
        throw invalid('minutes');
      }
      minutes = input.minutes;
    }
    assertWithinClinicHours(start, minutes);

    const updated = await transaction(async (tx) => {
      await lockClinicBookings(tx, actor.clinicId);
      const end = start + minutes * 60_000;
      await assertSlotFree(tx, {
        clinicId: actor.clinicId,
        vetId,
        roomId,
        start,
        end,
        excludeId: existing.id,
      });
      await tx.query(
        'update appointments set start_at = $2, end_at = $3, vet_id = $4, room_id = $5 where id = $1',
        [existing.id, new Date(start).toISOString(), new Date(end).toISOString(), vetId, roomId],
      );
      return loadAppointment(tx, existing.id, actor.clinicId);
    });
    publishCalendar(actor.clinicId);
    return ok(toApiAppointment(updated));
  }),
);

const TRANSITIONS: { path: string; action: string }[] = [
  { path: 'check-in', action: 'check-in' },
  { path: 'start', action: 'start' },
  { path: 'complete', action: 'complete' },
  { path: 'no-show', action: 'no-show' },
];

for (const transition of TRANSITIONS) {
  appointmentRouter.post(
    `/api/appointments/:id/${transition.path}`,
    route(async (request) => {
      const actor = await requireActor(request);
      const existing = await transaction((tx) =>
        loadAppointment(tx, request.params.id, actor.clinicId),
      );
      requireCapability(
        actor,
        transition.action === 'start' || transition.action === 'complete'
          ? 'consult.manage'
          : 'appointment.manage',
      );
      const now = serverNow();
      const updated = await transaction(async (tx) => {
        await lockClinicBookings(tx, actor.clinicId);
        const current = await loadAppointment(tx, existing.id, actor.clinicId);
        const next = assertTransition(current.status, transition.action);
        if (transition.action === 'no-show' && now < current.start_at.getTime()) {
          throw new AppError('too_early');
        }
        if (transition.action === 'check-in') {
          const late = lateByMinutes(current.start_at, new Date(now));
          await tx.query(
            'update appointments set status = $2, checked_in_at = $3, checked_in_late_minutes = $4 where id = $1',
            [current.id, next, new Date(now).toISOString(), late],
          );
        } else {
          await tx.query('update appointments set status = $2 where id = $1', [current.id, next]);
        }
        return loadAppointment(tx, current.id, actor.clinicId);
      });
      publishCalendar(actor.clinicId);
      return ok(toApiAppointment(updated));
    }),
  );
}

appointmentRouter.delete(
  '/api/appointments/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const existing = await transaction((tx) => loadAppointment(tx, request.params.id, actor.clinicId));
    requireCapability(actor, 'appointment.manage');
    const now = serverNow();
    const result = await transaction(async (tx) => {
      const current = await loadAppointment(tx, existing.id, actor.clinicId);
      assertTransition(current.status, 'cancel');
      await tx.query(
        `update appointments set status = 'cancelled', previous_status = $2, cancelled_at = $3 where id = $1`,
        [current.id, current.status, new Date(now).toISOString()],
      );
      return current;
    });
    publishCalendar(actor.clinicId);
    return ok({
      id: result.id,
      status: 'cancelled',
      undoUntil: new Date(now + settings.undoSeconds * 1000).toISOString(),
      now: new Date(now).toISOString(),
    });
  }),
);

appointmentRouter.post(
  '/api/appointments/:id/restore',
  route(async (request) => {
    const actor = await requireActor(request);
    const existing = await transaction((tx) => loadAppointment(tx, request.params.id, actor.clinicId));
    requireCapability(actor, 'appointment.manage');
    const now = serverNow();
    const restored = await transaction(async (tx) => {
      await lockClinicBookings(tx, actor.clinicId);
      const current = await loadAppointment(tx, existing.id, actor.clinicId);
      if (current.status !== 'cancelled') {
        throw new AppError('invalid_transition', { status: STATUS_LABELS[current.status] });
      }
      const cancelledAt = current.cancelled_at?.getTime() ?? 0;
      if (now > cancelledAt + settings.undoSeconds * 1000) throw new AppError('undo_expired');
      await assertSlotFree(tx, {
        clinicId: actor.clinicId,
        vetId: current.vet_id,
        roomId: current.room_id,
        start: current.start_at.getTime(),
        end: current.end_at.getTime(),
        excludeId: current.id,
      });
      const previous: AppointmentStatus = current.previous_status ?? 'booked';
      await tx.query(
        'update appointments set status = $2, previous_status = null, cancelled_at = null where id = $1',
        [current.id, previous],
      );
      return loadAppointment(tx, current.id, actor.clinicId);
    });
    publishCalendar(actor.clinicId);
    return ok(toApiAppointment(restored));
  }),
);

appointmentRouter.get(
  '/api/queue',
  route(async (request) => {
    const actor = await requireActor(request);
    const rows = await query<AppointmentView>(
      `${APPOINTMENT_SELECT}
        where a.clinic_id = $1 and a.status = 'checked-in'
        order by a.checked_in_at, a.id`,
      [actor.clinicId],
    );
    const now = serverNow();
    return ok({
      queue: rows.map((row) => ({
        appointmentId: row.id,
        patientId: row.patient_id,
        patientName: row.patient_name,
        species: row.species,
        photoFileId: row.photo_file_id,
        vetName: row.vet_name,
        checkedInAt: row.checked_in_at ? row.checked_in_at.toISOString() : null,
        waitingMinutes: row.checked_in_at ? waitingMinutes(row.checked_in_at, now) : 0,
        lateByMinutes: row.checked_in_late_minutes,
      })),
    });
  }),
);

appointmentRouter.get(
  '/api/appointments/:id/note',
  route(async (request) => {
    const actor = await requireActor(request);
    const appointment = await transaction((tx) =>
      loadAppointment(tx, request.params.id, actor.clinicId),
    );
    const paragraphs = await loadNote(appointment.id);
    return ok({
      appointmentId: appointment.id,
      patientId: appointment.patient_id,
      patientName: appointment.patient_name,
      status: appointment.status,
      paragraphs,
    });
  }),
);

async function loadNote(appointmentId: string): Promise<Record<string, unknown>[]> {
  let rows = await query<{ n: number; text: string; version: number; edited_by: string | null }>(
    `select p.n, p.text, p.version, u.name as edited_by
       from note_paragraphs p left join users u on u.id = p.edited_by
      where p.appointment_id = $1 order by p.n`,
    [appointmentId],
  );
  if (rows.length === 0) {
    await query(
      `insert into note_paragraphs (id, appointment_id, n, text, version) values ($1,$2,1,'',1)
       on conflict (appointment_id, n) do nothing`,
      [newId(), appointmentId],
    );
    rows = await query(
      `select p.n, p.text, p.version, u.name as edited_by
         from note_paragraphs p left join users u on u.id = p.edited_by
        where p.appointment_id = $1 order by p.n`,
      [appointmentId],
    );
  }
  return rows.map((row) => ({
    n: row.n,
    text: row.text,
    version: row.version,
    editedBy: row.edited_by,
  }));
}

appointmentRouter.put(
  '/api/appointments/:id/note/paragraphs/:n',
  route(async (request) => {
    const actor = await requireActor(request);
    const appointment = await transaction((tx) =>
      loadAppointment(tx, request.params.id, actor.clinicId),
    );
    const n = Number(request.params.n);
    const paragraph = await one<{ id: string; version: number; edited_by: string | null }>(
      'select id, version, edited_by from note_paragraphs where appointment_id = $1 and n = $2',
      [appointment.id, n],
    );
    if (!paragraph) throw new AppError('not_found');
    requireCapability(actor, 'consult.manage');
    const input = body(request);
    const text = typeof input.text === 'string' ? input.text : '';
    if (typeof input.version !== 'number' || !Number.isInteger(input.version)) {
      throw invalid('version');
    }
    if (text.length > 5000) throw new AppError('paragraph_too_long', { field: 'text' });

    const saved = await transaction(async (tx) => {
      const current = await tx.one<{ version: number; edited_by: string | null }>(
        'select version, edited_by from note_paragraphs where appointment_id = $1 and n = $2 for update',
        [appointment.id, n],
      );
      if (!current) throw new AppError('not_found');
      if (current.version !== input.version) {
        const winner = current.edited_by
          ? await tx.one<{ name: string }>('select name from users where id = $1', [current.edited_by])
          : null;
        throw new AppError('stale_paragraph', { name: winner?.name ?? 'Another vet' });
      }
      const version = current.version + 1;
      await tx.query(
        'update note_paragraphs set text = $3, version = $4, edited_by = $5 where appointment_id = $1 and n = $2',
        [appointment.id, n, text, version, actor.id],
      );
      await tx.query(
        'insert into note_operations (appointment_id, n, text, version, by_user) values ($1,$2,$3,$4,$5)',
        [appointment.id, n, text, version, actor.id],
      );
      return { n, text, version, editedBy: actor.name };
    });
    publish(actor.clinicId, {
      kind: 'changed',
      topics: ['note'],
      noteAppointmentId: appointment.id,
    });
    return ok(saved);
  }),
);

appointmentRouter.post(
  '/api/appointments/:id/note/paragraphs',
  route(async (request) => {
    const actor = await requireActor(request);
    const appointment = await transaction((tx) =>
      loadAppointment(tx, request.params.id, actor.clinicId),
    );
    requireCapability(actor, 'consult.manage');
    const input = body(request);
    const text = typeof input.text === 'string' ? input.text : '';
    if (text.length > 5000) throw new AppError('paragraph_too_long', { field: 'text' });
    const saved = await transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1), 3)', [appointment.id]);
      const highest = await tx.one<{ highest: number | null }>(
        'select max(n) as highest from note_paragraphs where appointment_id = $1',
        [appointment.id],
      );
      const n = (highest?.highest ?? 0) + 1;
      await tx.query(
        'insert into note_paragraphs (id, appointment_id, n, text, version, edited_by) values ($1,$2,$3,$4,1,$5)',
        [newId(), appointment.id, n, text, actor.id],
      );
      await tx.query(
        'insert into note_operations (appointment_id, n, text, version, by_user) values ($1,$2,$3,1,$4)',
        [appointment.id, n, text, actor.id],
      );
      return { n, text, version: 1, editedBy: actor.name };
    });
    publish(actor.clinicId, {
      kind: 'changed',
      topics: ['note'],
      noteAppointmentId: appointment.id,
    });
    return created(saved);
  }),
);

