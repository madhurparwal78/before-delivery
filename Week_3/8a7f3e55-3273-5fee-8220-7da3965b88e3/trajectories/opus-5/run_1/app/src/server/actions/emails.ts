import { formatDollars } from '../domain/billing.js';
import { addMinutes, agencyClock, agencyDate } from '../domain/time.js';
import type { BookingRecord, HolderRecord } from '../store/bookings.js';

function startStamp(booking: BookingRecord): { date: string; time: string } {
  return { date: agencyDate(booking.start_at), time: agencyClock(booking.start_at) };
}

function window(booking: BookingRecord): string {
  const end = addMinutes(booking.start_at, booking.duration_minutes);
  return `${agencyDate(booking.start_at)} ${agencyClock(booking.start_at)} to ${agencyDate(end)} ${agencyClock(end)} (${booking.duration_minutes} minutes)`;
}

export function assignmentSubject(booking: BookingRecord): string {
  const { date, time } = startStamp(booking);
  return `Assignment confirmed: ${booking.ref} on ${date} at ${time}`;
}

export function coverageSubject(booking: BookingRecord): string {
  const { date, time } = startStamp(booking);
  return `Booking covered: ${booking.ref} on ${date} at ${time}`;
}

export function cancellationSubject(booking: BookingRecord): string {
  const { date, time } = startStamp(booking);
  return `Booking cancelled: ${booking.ref} on ${date} at ${time}`;
}

/** Interpreter copies carry assignment facts only: never notes, rates or money amounts. */
export function assignmentBody(
  booking: BookingRecord,
  seat: number,
  coInterpreterName: string | null,
  prepFileCount: number,
): string {
  const lines = [
    `You hold seat ${seat} on ${booking.ref}.`,
    '',
    `Setting: ${booking.setting}`,
    `Title: ${booking.title}`,
    `When: ${window(booking)}`,
    `Location: ${booking.location}`,
    `On-site contact: ${booking.onsite_contact_name}, ${booking.onsite_contact_phone}`,
    `Deaf consumer: ${booking.consumer_name}`,
    `Prep files available: ${prepFileCount}`,
  ];
  if (coInterpreterName !== null) lines.push(`Team interpreter: ${coInterpreterName}`);
  return lines.join('\n');
}

export function coverageBody(booking: BookingRecord, heldBy: readonly HolderRecord[]): string {
  const lines = [
    `${booking.ref} is fully covered.`,
    '',
    `Title: ${booking.title}`,
    `When: ${window(booking)}`,
    '',
    'Interpreters:',
    ...heldBy.map(
      (holder) =>
        `- ${holder.name} (${holder.credentials.map((credential) => credential.code).join(', ')})`,
    ),
  ];
  return lines.join('\n');
}

export function interpreterCancellationBody(
  booking: BookingRecord,
  seat: number,
  late: boolean,
): string {
  const lines = [
    `${booking.ref} has been cancelled. You no longer hold seat ${seat}.`,
    '',
    `Setting: ${booking.setting}`,
    `Title: ${booking.title}`,
    `When: ${window(booking)}`,
    `Location: ${booking.location}`,
  ];
  if (late) lines.push('', 'This was a late cancellation.');
  return lines.join('\n');
}

export function requesterCancellationBody(
  booking: BookingRecord,
  heldBy: readonly HolderRecord[],
  chargeCents: number,
): string {
  const lines = [
    `${booking.ref} has been cancelled.`,
    '',
    `Title: ${booking.title}`,
    `When: ${window(booking)}`,
  ];
  if (heldBy.length > 0) {
    lines.push(
      '',
      'Interpreters released:',
      ...heldBy.map(
        (holder) =>
          `- ${holder.name} (${holder.credentials.map((credential) => credential.code).join(', ')})`,
      ),
    );
  }
  lines.push(
    '',
    chargeCents > 0
      ? `Late cancellation charge: ${formatDollars(chargeCents)}`
      : 'No cancellation charge.',
  );
  return lines.join('\n');
}
