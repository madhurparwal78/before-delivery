import { APPOINTMENT_REASONS, APPOINTMENT_STATUS_LABEL, type AppointmentReason, type AppointmentStatus } from '../shared/domain.js';
import { addDays, clinicDate, clinicInstant, clinicMinuteOfDay, isIsoDate } from '../shared/clinictime.js';
import { clinicHours, config } from './config.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { route } from './http.js';
import { publish } from './live.js';
import { type Body, loadIn, oneOf, ref, whole } from './support.js';

const SELECT = `
  SELECT a.id, a.clinic_id, a.patient_id, a.vet_id, a.room_id, a.start_at, a.minutes, a.reason, a.status,
         a.checked_in_at, a.late_by_minutes, a.cancelled_at, a.status_before_cancel,
         p.name AS patient_name, p.species, v.name AS vet_name, r.name AS room_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users v ON v.id = a.vet_id
    JOIN rooms r ON r.id = a.room_id`;

interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  vet_id: string;
  room_id: string;
  start_at: Date;
  minutes: number;
  reason: AppointmentReason;
  status: AppointmentStatus;
  checked_in_at: Date | null;
  late_by_minutes: number | null;
  cancelled_at: Date | null;
  status_before_cancel: AppointmentStatus | null;
  patient_name: string;
  species: string;
  vet_name: string;
  room_name: string;
}

const endOf = (a: Pick<AppointmentRow, 'start_at' | 'minutes'>) => new Date(a.start_at.getTime() + a.minutes * 60_000);

/** A booked appointment is late from its start plus LATE_MINUTES, that moment included. The one lateness rule. */
function isLate(a: Pick<AppointmentRow, 'status' | 'start_at'>, at: Date): boolean {
  return a.status === 'booked' && at.getTime() >= a.start_at.getTime() + config.lateMinutes * 60_000;
}

/** Minutes from start to check-in, kept only when the check-in was late (at or after start plus LATE_MINUTES). */
export function lateByMinutes(start: Date, checkedInAt: Date): number | null {
  return checkedInAt.getTime() >= start.getTime() + config.lateMinutes * 60_000 ? Math.floor((checkedInAt.getTime() - start.getTime()) / 60_000) : null;
}

export function serializeAppointment(a: AppointmentRow, at: Date) {
  return {
    id: a.id,
    patientId: a.patient_id,
    patientName: a.patient_name,
    species: a.species,
    vetId: a.vet_id,
    vetName: a.vet_name,
    roomId: a.room_id,
    roomName: a.room_name,
    start: a.start_at.toISOString(),
    end: endOf(a).toISOString(),
    reason: a.reason,
    status: a.status,
    late: isLate(a, at),
  };
}

export const loadAppointment = (db: Db, clinicId: string, id: string) =>
  loadIn<AppointmentRow>(db, `${SELECT} WHERE a.id = $1 AND a.clinic_id = $2`, id, clinicId);

const OCCUPYING = `('booked','checked-in','in-consult','completed')`;

/** True when another appointment holds the same vet or the same room during the span. */
async function slotTaken(
  db: Db,
  clinicId: string,
  span: { vetId: string; roomId: string; start: Date; minutes: number; exclude?: string },
): Promise<boolean> {
  const end = new Date(span.start.getTime() + span.minutes * 60_000);
  const hit = await one(
    db,
    `SELECT 1 FROM appointments
      WHERE clinic_id = $1 AND status IN ${OCCUPYING} AND (vet_id = $2 OR room_id = $3)
        AND start_at < $5 AND start_at + make_interval(mins => minutes) > $4
        AND ($6::uuid IS NULL OR id <> $6) LIMIT 1`,
    [clinicId, span.vetId, span.roomId, span.start, end, span.exclude ?? null],
  );
  return hit !== undefined;
}

/** Appointments start on a slot boundary, last whole slots and sit within clinic hours (08:00 to 18:00). */
function checkSpan(start: Date, minutes: number): void {
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 || (start.getTime() / 60_000) % config.slotMinutes !== 0) {
    throw invalid('start', 'start');
  }
  const begin = clinicMinuteOfDay(start);
  const finish = begin + minutes;
  const sameDay = clinicDate(start) === clinicDate(new Date(start.getTime() + minutes * 60_000 - 1));
  if (begin < clinicHours.openMinute || finish > clinicHours.closeMinute || !sameDay) {
    throw new AppError('outside_hours', undefined, 'start');
  }
}

function parseInstant(value: unknown, key: string): Date {
  if (value === undefined || value === null || value === '') throw invalid(key, key, true);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) throw invalid(key, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw invalid(key, key);
  return parsed;
}

function minutesOf(body: Body, fallback: number): number {
  if (body.minutes === undefined) return fallback;
  const minutes = whole(body, 'minutes', config.slotMinutes, 120, 'minutes');
  if (minutes % config.slotMinutes !== 0) throw invalid('minutes', 'minutes');
  return minutes;
}

const statusLabel = (s: AppointmentStatus) => APPOINTMENT_STATUS_LABEL[s];
const invalidTransition = (a: Pick<AppointmentRow, 'status'>) =>
  new AppError('invalid_transition', `This appointment is ${statusLabel(a.status)} and cannot be changed that way.`);

async function dayAppointments(db: Db, clinicId: string, date: string): Promise<AppointmentRow[]> {
  const from = clinicInstant(date, 0, 0)!;
  const to = clinicInstant(addDays(date, 1), 0, 0)!;
  return rows<AppointmentRow>(
    db,
    `${SELECT} WHERE a.clinic_id = $1 AND a.start_at >= $2 AND a.start_at < $3
        AND a.status IN ('booked','checked-in','in-consult','completed')
      ORDER BY a.start_at, r.position, a.id`,
    [clinicId, from, to],
  );
}

async function changed(db: Db, clinicId: string): Promise<void> {
  await publish(db, clinicId, { t: 'calendar' });
  await publish(db, clinicId, { t: 'queue' });
  await publish(db, clinicId, { t: 'ward' });
  await publish(db, clinicId, { t: 'patients' });
}

async function vetOf(db: Db, clinicId: string, id: string) {
  return one<{ id: string }>(db, `SELECT id FROM users WHERE id = $1 AND clinic_id = $2 AND role = 'vet' AND status = 'Active'`, [id, clinicId]);
}

/** Book one appointment: every other path that books (the public page) comes through here. */
export async function createAppointment(
  db: Db,
  clinicId: string,
  input: { patientId: string; vetId: string; roomId: string; start: Date; minutes: number; reason: AppointmentReason },
): Promise<AppointmentRow> {
  checkSpan(input.start, input.minutes);
  if (await slotTaken(db, clinicId, input)) throw new AppError('slot_taken');
  const made = await one<{ id: string }>(
    db,
    `INSERT INTO appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'booked') RETURNING id`,
    [clinicId, input.patientId, input.vetId, input.roomId, input.start, input.minutes, input.reason],
  );
  return loadAppointment(db, clinicId, made!.id);
}

export function registerAppointmentRoutes(): void {
  route('GET', '/api/appointments', async (ctx) => {
    const user = await ctx.user();
    const date = ctx.query.get('date') ?? clinicDate(now());
    if (!isIsoDate(date)) throw invalid('date', 'Day');
    const at = now();
    const list = await dayAppointments(pool, user.clinicId, date);
    ctx.send(200, { appointments: list.map((a) => serializeAppointment(a, at)) });
  });

  route('POST', '/api/appointments', async (ctx) => {
    const user = await ctx.user();
    const body = await ctx.json();
    const patient = await ref(body, 'patientId', (id) => one<{ id: string }>(pool, 'SELECT id FROM patients WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    const vetRecord = await ref(body, 'vetId', (id) => one<{ id: string; role: string }>(pool, 'SELECT id, role FROM users WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    const room = await ref(body, 'roomId', (id) => one<{ id: string }>(pool, 'SELECT id FROM rooms WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    ctx.allow(user, 'appointments.write');
    if (!patient) throw invalid('patientId', 'Patient', true);
    if (!vetRecord) throw invalid('vetId', 'Vet', true);
    if (vetRecord.role !== 'vet') throw invalid('vetId', 'Vet');
    if (!room) throw invalid('roomId', 'roomId', true);
    const start = parseInstant(body.start, 'start');
    const minutes = minutesOf(body, config.slotMinutes);
    const reason = oneOf(body, 'reason', APPOINTMENT_REASONS);
    const made = await transaction(user.clinicId, async (db) => {
      const row = await createAppointment(db, user.clinicId, { patientId: patient.id, vetId: vetRecord.id, roomId: room.id, start, minutes, reason });
      await changed(db, user.clinicId);
      return row;
    });
    ctx.send(201, serializeAppointment(made, now()));
  });

  route('PATCH', '/api/appointments/:id', async (ctx) => {
    const user = await ctx.user();
    const existing = await loadAppointment(pool, user.clinicId, ctx.params.id);
    const body = await ctx.json();
    const room = await ref(body, 'roomId', (id) => one<{ id: string }>(pool, 'SELECT id FROM rooms WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    const vet = await ref(body, 'vetId', (id) => vetOf(pool, user.clinicId, id));
    ctx.allow(user, 'appointments.write');
    const updated = await transaction(user.clinicId, async (db) => {
      const current = await loadAppointment(db, user.clinicId, existing.id);
      if (current.status !== 'booked') throw invalidTransition(current);
      const start = body.start === undefined ? current.start_at : parseInstant(body.start, 'start');
      const minutes = minutesOf(body, current.minutes);
      const target = { vetId: vet?.id ?? current.vet_id, roomId: room?.id ?? current.room_id, start, minutes };
      checkSpan(start, minutes);
      if (await slotTaken(db, user.clinicId, { ...target, exclude: current.id })) throw new AppError('slot_taken');
      await db.query('UPDATE appointments SET vet_id = $2, room_id = $3, start_at = $4, minutes = $5 WHERE id = $1', [
        current.id,
        target.vetId,
        target.roomId,
        start,
        minutes,
      ]);
      await changed(db, user.clinicId);
      return loadAppointment(db, user.clinicId, current.id);
    });
    ctx.send(200, serializeAppointment(updated, now()));
  });

  const transitionRoute = (
    action: string,
    permission: 'appointments.write' | 'consult.run',
    from: AppointmentStatus,
    to: AppointmentStatus,
    extra?: (a: AppointmentRow, at: Date) => void,
  ) =>
    route('POST', `/api/appointments/:id/${action}`, async (ctx) => {
      const user = await ctx.user();
      await loadAppointment(pool, user.clinicId, ctx.params.id);
      ctx.allow(user, permission);
      const updated = await transaction(user.clinicId, async (db) => {
        const current = await loadAppointment(db, user.clinicId, ctx.params.id);
        if (current.status !== from) throw invalidTransition(current);
        const at = now();
        extra?.(current, at);
        if (to === 'checked-in') {
          await db.query(`UPDATE appointments SET status = $2, checked_in_at = $3, late_by_minutes = $4 WHERE id = $1`, [current.id, to, at, lateByMinutes(current.start_at, at)]);
        } else {
          await db.query('UPDATE appointments SET status = $2 WHERE id = $1', [current.id, to]);
        }
        await changed(db, user.clinicId);
        return loadAppointment(db, user.clinicId, current.id);
      });
      ctx.send(200, serializeAppointment(updated, now()));
    });

  transitionRoute('check-in', 'appointments.write', 'booked', 'checked-in');
  transitionRoute('start', 'consult.run', 'checked-in', 'in-consult');
  transitionRoute('complete', 'consult.run', 'in-consult', 'completed');
  transitionRoute('no-show', 'appointments.write', 'booked', 'no-show', (a, at) => {
    if (at.getTime() < a.start_at.getTime()) throw new AppError('too_early');
  });

  route('DELETE', '/api/appointments/:id', async (ctx) => {
    const user = await ctx.user();
    await loadAppointment(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'appointments.write');
    const result = await transaction(user.clinicId, async (db) => {
      const current = await loadAppointment(db, user.clinicId, ctx.params.id);
      if (current.status !== 'booked' && current.status !== 'checked-in') throw invalidTransition(current);
      const at = now();
      await db.query(`UPDATE appointments SET status = 'cancelled', status_before_cancel = $2, cancelled_at = $3 WHERE id = $1`, [current.id, current.status, at]);
      await changed(db, user.clinicId);
      return { id: current.id, status: 'cancelled', undoUntil: new Date(at.getTime() + config.undoSeconds * 1000).toISOString(), now: at.toISOString() };
    });
    ctx.send(200, result);
  });

  route('POST', '/api/appointments/:id/restore', async (ctx) => {
    const user = await ctx.user();
    await loadAppointment(pool, user.clinicId, ctx.params.id);
    ctx.allow(user, 'appointments.write');
    const restored = await transaction(user.clinicId, async (db) => {
      const current = await loadAppointment(db, user.clinicId, ctx.params.id);
      if (current.status !== 'cancelled') throw invalidTransition(current);
      if (now().getTime() > current.cancelled_at!.getTime() + config.undoSeconds * 1000) throw new AppError('undo_expired');
      if (await slotTaken(db, user.clinicId, { vetId: current.vet_id, roomId: current.room_id, start: current.start_at, minutes: current.minutes, exclude: current.id })) {
        throw new AppError('slot_taken');
      }
      await db.query('UPDATE appointments SET status = $2, cancelled_at = NULL, status_before_cancel = NULL WHERE id = $1', [current.id, current.status_before_cancel]);
      await changed(db, user.clinicId);
      return loadAppointment(db, user.clinicId, current.id);
    });
    ctx.send(200, serializeAppointment(restored, now()));
  });

  route('GET', '/api/queue', async (ctx) => {
    const user = await ctx.user();
    const at = now();
    const list = await rows<AppointmentRow>(pool, `${SELECT} WHERE a.clinic_id = $1 AND a.status = 'checked-in' ORDER BY a.checked_in_at, a.id`, [user.clinicId]);
    ctx.send(200, {
      queue: list.map((a) => ({
        appointmentId: a.id,
        patientId: a.patient_id,
        patientName: a.patient_name,
        species: a.species,
        vetName: a.vet_name,
        checkedInAt: a.checked_in_at!.toISOString(),
        waitingMinutes: Math.max(0, Math.floor((at.getTime() - a.checked_in_at!.getTime()) / 60_000)),
        lateByMinutes: a.late_by_minutes,
      })),
    });
  });

  route('GET', '/api/rooms', async (ctx) => {
    const user = await ctx.user();
    ctx.send(200, { rooms: await rows(pool, 'SELECT id, name FROM rooms WHERE clinic_id = $1 ORDER BY position', [user.clinicId]) });
  });

  route('GET', '/api/vets', async (ctx) => {
    const user = await ctx.user();
    ctx.send(200, { vets: await rows(pool, `SELECT id, name FROM users WHERE clinic_id = $1 AND role = 'vet' AND status = 'Active' ORDER BY name`, [user.clinicId]) });
  });

  route('GET', '/api/clients', async (ctx) => {
    const user = await ctx.user();
    const clients = await rows<{ id: string; name: string }>(pool, 'SELECT id, name FROM clients WHERE clinic_id = $1 ORDER BY name', [user.clinicId]);
    const patients = await rows<{ id: string; name: string; client_id: string }>(pool, 'SELECT id, name, client_id FROM patients WHERE clinic_id = $1 ORDER BY name', [user.clinicId]);
    ctx.send(200, { clients: clients.map((c) => ({ id: c.id, name: c.name, patients: patients.filter((p) => p.client_id === c.id).map((p) => ({ id: p.id, name: p.name })) })) });
  });
}

