import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid, type ApiError } from '../errors.js';
import { clinicHourMinute, clinicDateOf } from '../tz.js';
import * as bus from '../live.js';

const ACTIVE = ['booked', 'checked-in', 'in-consult', 'completed'];

export const STATUS_LABELS: Record<string, string> = {
  'booked': 'Booked',
  'checked-in': 'Checked in',
  'in-consult': 'In consult',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'no-show': 'No-show',
};

// The one place that decides the appointment edges.
const EDGES: Record<string, Record<string, string>> = {
  'booked': { 'check-in': 'checked-in', cancel: 'cancelled', 'no-show': 'no-show' },
  'checked-in': { start: 'in-consult', cancel: 'cancelled' },
  'in-consult': { complete: 'completed' },
};

export function transitionFrom(status: string, action: string): string | null {
  return EDGES[status]?.[action] ?? null;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export async function getAppointment(id: string, clinicId: string) {
  const row = await one(
    `select a.*, p.name as patient_name, p.species, u.name as vet_name, r.name as room_name
     from appointments a
     join patients p on p.id = a.patient_id
     join users u on u.id = a.vet_id
     join rooms r on r.id = a.room_id
     where a.id = $1 and a.clinic_id = $2`,
    [id, clinicId]
  );
  return row;
}

export function isLate(startAt: Date, now: Date = clockNow()): boolean {
  return now.getTime() >= startAt.getTime() + settings.lateMinutes * 60000;
}

export async function slotFree(
  clinicId: string, vetId: string, roomId: string, start: Date, minutes: number, exceptId?: string
): Promise<boolean> {
  const r = await q(
    `select id from appointments
     where clinic_id = $1 and status = any($2) and start_at < $3 and start_at + (minutes || ' minutes')::interval > $4
       and (vet_id = $5 or room_id = $6) and ($7::text is null or id <> $7)`,
    [clinicId, ACTIVE, new Date(start.getTime() + minutes * 60000), start, vetId, roomId, exceptId ?? null]
  );
  return r.rows.length === 0;
}

export function parseStart(value: unknown): Date {
  if (typeof value !== 'string') throw notValid('start');
  const d = new Date(value);
  if (isNaN(d.getTime())) throw notValid('start');
  return d;
}

export function checkClinicHours(start: Date, minutes: number): void {
  const end = new Date(start.getTime() + minutes * 60000);
  const s = clinicHourMinute(start);
  const e = clinicHourMinute(end);
  const startMinutes = s.hour * 60 + s.minute;
  const endMinutes = e.hour * 60 + e.minute;
  const sameDay = clinicDateOf(start) === clinicDateOf(end);
  const ok = startMinutes >= settings.clinicHours.start * 60 &&
    (sameDay ? endMinutes <= settings.clinicHours.end * 60 : false);
  if (!ok) throw t('outside_hours', { field: 'start' });
}

export function checkSlotBoundary(start: Date): void {
  if (start.getTime() % (settings.slotMinutes * 60000) !== 0) throw notValid('start');
}

export function checkMinutes(minutes: unknown): number {
  if (minutes === undefined || minutes === null) return settings.slotMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) throw notValid('minutes');
  if (minutes < settings.slotMinutes || minutes > 120 || minutes % settings.slotMinutes !== 0) throw notValid('minutes');
  return minutes;
}

export function transitionError(status: string): ApiError {
  return t('invalid_transition', { Status: statusLabel(status) });
}
