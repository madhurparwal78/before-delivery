import { CLINIC_CLOSE_MINUTE, CLINIC_OPEN_MINUTE, settings } from '../config';
import { addClinicDays, clinicDateOf, instantOfSlot, serverNow } from '../clock';
import type { Tx } from '../db';
import { AppError } from '../errors';
import { OCCUPYING_STATUSES } from './appointments';

export const PUBLIC_REASONS = ['Check-up', 'Vaccination', 'Limping or injury', 'Off their food'] as const;
export type PublicReason = (typeof PUBLIC_REASONS)[number];

export function isPublicReason(value: unknown): value is PublicReason {
  return PUBLIC_REASONS.includes(value as PublicReason);
}

export function appointmentReasonFor(reason: PublicReason): 'Consult' | 'Vaccination' {
  return reason === 'Vaccination' ? 'Vaccination' : 'Consult';
}

export const SPECIES = ['dog', 'cat', 'rabbit', 'other'] as const;

export function isSpecies(value: unknown): value is (typeof SPECIES)[number] {
  return SPECIES.includes(value as (typeof SPECIES)[number]);
}

/** The one place the online booking window is decided. */
export function startIsBookable(start: number, reason: PublicReason, now = serverNow()): boolean {
  const earliest = now + settings.bookingLeadMinutes * 60_000;
  const latest = now + settings.bookingHorizonDays * 86_400_000;
  if (start < earliest || start > latest) return false;
  const date = clinicDateOf(start);
  const slotStart = instantOfSlot(date, CLINIC_OPEN_MINUTE);
  if (slotStart === null) return false;
  const minuteOfDay = Math.round((start - slotStart) / 60_000) + CLINIC_OPEN_MINUTE;
  if (minuteOfDay % settings.slotMinutes !== 0) return false;
  if (minuteOfDay < CLINIC_OPEN_MINUTE) return false;
  if (minuteOfDay + settings.slotMinutes > CLINIC_CLOSE_MINUTE) return false;
  if (reason === 'Vaccination' && minuteOfDay >= 12 * 60) return false;
  return true;
}

export type OfferedSlot = { start: string; vetId: string; vetName: string };

export async function offeredSlots(
  tx: Tx,
  input: { clinicId: string; date: string; reason: PublicReason; now: number },
): Promise<OfferedSlot[]> {
  const vets = await tx.query<{ id: string; name: string }>(
    `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
    [input.clinicId],
  );
  const rooms = await tx.query<{ id: string }>(
    'select id from rooms where clinic_id = $1 order by sort, name',
    [input.clinicId],
  );
  const busy = await tx.query<{ vet_id: string; room_id: string; start_at: Date; end_at: Date }>(
    `select vet_id, room_id, start_at, end_at from appointments
      where clinic_id = $1 and status = any($2)
        and start_at >= $3 and start_at < $4`,
    [
      input.clinicId,
      OCCUPYING_STATUSES,
      new Date(Date.parse(`${input.date}T00:00:00Z`) - 86_400_000).toISOString(),
      new Date(Date.parse(`${addClinicDays(input.date, 1)}T00:00:00Z`) + 86_400_000).toISOString(),
    ],
  );
  const offers: OfferedSlot[] = [];
  for (
    let minute = CLINIC_OPEN_MINUTE;
    minute + settings.slotMinutes <= CLINIC_CLOSE_MINUTE;
    minute += settings.slotMinutes
  ) {
    const start = instantOfSlot(input.date, minute);
    if (start === null) continue;
    const end = start + settings.slotMinutes * 60_000;
    if (!startIsBookable(start, input.reason, input.now)) continue;
    const overlapping = busy.filter(
      (row) => row.start_at.getTime() < end && row.end_at.getTime() > start,
    );
    const roomFree = rooms.some((room) => !overlapping.some((row) => row.room_id === room.id));
    if (!roomFree) continue;
    for (const vet of vets) {
      if (overlapping.some((row) => row.vet_id === vet.id)) continue;
      offers.push({ start: new Date(start).toISOString(), vetId: vet.id, vetName: vet.name });
    }
  }
  return offers;
}

export async function firstFreeRoom(
  tx: Tx,
  input: { clinicId: string; start: number; end: number },
): Promise<string | null> {
  const rooms = await tx.query<{ id: string }>(
    'select id from rooms where clinic_id = $1 order by sort, name',
    [input.clinicId],
  );
  for (const room of rooms) {
    const clash = await tx.one<{ id: string }>(
      `select id from appointments where clinic_id = $1 and room_id = $2 and status = any($3)
         and start_at < $5 and end_at > $4 limit 1`,
      [
        input.clinicId,
        room.id,
        OCCUPYING_STATUSES,
        new Date(input.start).toISOString(),
        new Date(input.end).toISOString(),
      ],
    );
    if (!clash) return room.id;
  }
  return null;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Owner and pet names are 1 to 80 Unicode characters with no control character. */
export function readOwnerText(value: unknown, field: 'ownerName' | 'petName'): string {
  const copy = field === 'ownerName' ? 'Enter your name.' : "Enter your pet's name.";
  if (typeof value !== 'string') throw new AppError('validation_failed', { field, copy });
  const trimmed = value.trim();
  if (CONTROL_CHARACTERS.test(value) || CONTROL_CHARACTERS.test(trimmed)) {
    throw new AppError('validation_failed', { field, copy });
  }
  const length = [...trimmed].length;
  if (length < 1 || length > 80) throw new AppError('validation_failed', { field, copy });
  return trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readOwnerEmail(value: unknown): string {
  const copy = 'Enter an email address like name@example.com.';
  if (typeof value !== 'string') throw new AppError('validation_failed', { field: 'ownerEmail', copy });
  const trimmed = value.trim();
  if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > 200) {
    throw new AppError('validation_failed', { field: 'ownerEmail', copy });
  }
  return trimmed;
}
