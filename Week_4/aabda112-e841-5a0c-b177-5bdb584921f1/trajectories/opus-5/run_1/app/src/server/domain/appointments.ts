import { CLINIC_CLOSE_MINUTE, CLINIC_OPEN_MINUTE, settings } from '../config';
import { clinicDateOf, clinicMinuteOf, serverNow } from '../clock';
import type { Tx } from '../db';
import { AppError, invalid } from '../errors';

export type AppointmentStatus =
  | 'booked'
  | 'checked-in'
  | 'in-consult'
  | 'completed'
  | 'cancelled'
  | 'no-show';

export type AppointmentRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  vet_id: string;
  room_id: string;
  start_at: Date;
  end_at: Date;
  reason: string;
  status: AppointmentStatus;
  checked_in_at: Date | null;
  checked_in_late_minutes: number | null;
  previous_status: AppointmentStatus | null;
  cancelled_at: Date | null;
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  'checked-in': 'Checked in',
  'in-consult': 'In consult',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
};

export const OCCUPYING_STATUSES: AppointmentStatus[] = [
  'booked',
  'checked-in',
  'in-consult',
  'completed',
];

export const REASONS = ['Consult', 'Vaccination', 'Surgery'] as const;
export type Reason = (typeof REASONS)[number];

type Edge = { from: AppointmentStatus; to: AppointmentStatus; action: string };

const EDGES: Edge[] = [
  { from: 'booked', to: 'checked-in', action: 'check-in' },
  { from: 'booked', to: 'cancelled', action: 'cancel' },
  { from: 'booked', to: 'no-show', action: 'no-show' },
  { from: 'checked-in', to: 'in-consult', action: 'start' },
  { from: 'checked-in', to: 'cancelled', action: 'cancel' },
  { from: 'in-consult', to: 'completed', action: 'complete' },
];

export function assertTransition(current: AppointmentStatus, action: string): AppointmentStatus {
  const edge = EDGES.find((candidate) => candidate.action === action && candidate.from === current);
  if (!edge) throw new AppError('invalid_transition', { status: STATUS_LABELS[current] });
  return edge.to;
}

export function assertMovable(current: AppointmentStatus): void {
  if (current !== 'booked') {
    throw new AppError('invalid_transition', { status: STATUS_LABELS[current] });
  }
}

export function isLate(
  row: Pick<AppointmentRow, 'status' | 'start_at'>,
  now = serverNow(),
): boolean {
  if (row.status !== 'booked') return false;
  return now >= row.start_at.getTime() + settings.lateMinutes * 60_000;
}

export function lateByMinutes(startAt: Date, checkedInAt: Date): number | null {
  const difference = checkedInAt.getTime() - startAt.getTime();
  if (difference < settings.lateMinutes * 60_000) return null;
  return Math.floor(difference / 60_000);
}

export function waitingMinutes(checkedInAt: Date, now = serverNow()): number {
  return Math.max(0, Math.floor((now - checkedInAt.getTime()) / 60_000));
}

export function validateStartAndLength(
  startIso: unknown,
  minutesInput: unknown,
): { start: number; minutes: number } {
  if (typeof startIso !== 'string' || Number.isNaN(Date.parse(startIso))) throw invalid('start');
  const start = Date.parse(startIso);
  let minutes = settings.slotMinutes;
  if (minutesInput !== undefined && minutesInput !== null) {
    if (
      typeof minutesInput !== 'number' ||
      !Number.isInteger(minutesInput) ||
      minutesInput < settings.slotMinutes ||
      minutesInput > 120 ||
      minutesInput % settings.slotMinutes !== 0
    ) {
      throw invalid('minutes');
    }
    minutes = minutesInput;
  }
  assertWithinClinicHours(start, minutes);
  return { start, minutes };
}

export function assertWithinClinicHours(start: number, minutes: number): void {
  const startMinute = clinicMinuteOf(start);
  if (startMinute % settings.slotMinutes !== 0) {
    throw new AppError('outside_hours', { field: 'start' });
  }
  const endMinute = startMinute + minutes;
  const sameDay = clinicDateOf(start) === clinicDateOf(start + minutes * 60_000 - 1);
  if (!sameDay || startMinute < CLINIC_OPEN_MINUTE || endMinute > CLINIC_CLOSE_MINUTE) {
    throw new AppError('outside_hours', { field: 'start' });
  }
}

/**
 * Rejects a claim overlapping the vet or the room. Callers hold the clinic's
 * booking lock, so simultaneous claims have exactly one winner.
 */
export async function assertSlotFree(
  tx: Tx,
  input: {
    clinicId: string;
    vetId: string;
    roomId: string;
    start: number;
    end: number;
    excludeId?: string;
  },
): Promise<void> {
  const clash = await tx.one<{ id: string }>(
    `select id from appointments
      where clinic_id = $1
        and status = any($2)
        and (vet_id = $3 or room_id = $4)
        and start_at < $6 and end_at > $5
        and ($7::text is null or id <> $7)
      limit 1`,
    [
      input.clinicId,
      OCCUPYING_STATUSES,
      input.vetId,
      input.roomId,
      new Date(input.start).toISOString(),
      new Date(input.end).toISOString(),
      input.excludeId ?? null,
    ],
  );
  if (clash) throw new AppError('slot_taken');
}

export async function lockClinicBookings(tx: Tx, clinicId: string): Promise<void> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1), 1)', [clinicId]);
}

export type AppointmentView = AppointmentRow & {
  patient_name: string;
  species: string;
  photo_file_id: string | null;
  vet_name: string;
  room_name: string;
};

export function toApiAppointment(row: AppointmentView, now = serverNow()): Record<string, unknown> {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    species: row.species,
    photoFileId: row.photo_file_id,
    vetId: row.vet_id,
    vetName: row.vet_name,
    roomId: row.room_id,
    roomName: row.room_name,
    start: row.start_at.toISOString(),
    end: row.end_at.toISOString(),
    reason: row.reason,
    status: row.status,
    late: isLate(row, now),
    checkedInAt: row.checked_in_at ? row.checked_in_at.toISOString() : null,
  };
}

export const APPOINTMENT_SELECT = `
  select a.*, p.name as patient_name, p.species as species, p.photo_file_id as photo_file_id,
         u.name as vet_name, r.name as room_name
    from appointments a
    join patients p on p.id = a.patient_id
    join users u on u.id = a.vet_id
    join rooms r on r.id = a.room_id`;
