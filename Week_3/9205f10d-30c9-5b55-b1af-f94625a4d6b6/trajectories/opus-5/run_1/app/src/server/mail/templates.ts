import type { CredentialType, SeatLabel, Setting } from '../../shared/types.js';
import { clockTime, monthDay, weekdayShort } from '../domain/agency-time.js';
import { env } from '../env.js';

export interface QueuedEmail {
  to_address: string;
  subject: string;
  body: string;
}

const SETTING_LABEL: Record<Setting, string> = {
  medical: 'Medical',
  education: 'Education',
  legal: 'Legal',
};

export function settingLabel(setting: Setting): string {
  return SETTING_LABEL[setting];
}

export function timeWindow(startsAt: Date, endsAt: Date): string {
  return `${clockTime(startsAt)} to ${clockTime(endsAt)}`;
}

export interface JobFacts {
  reference: string;
  setting: Setting;
  required_credential: CredentialType;
  starts_at: Date;
  ends_at: Date;
  city: string;
}

export function openSeatEmail(job: JobFacts, openSeatCount: number, to: string): QueuedEmail {
  return {
    to_address: to,
    subject: `Open seat: ${settingLabel(job.setting)}, ${job.required_credential}, ${monthDay(job.starts_at)}, ${timeWindow(job.starts_at, job.ends_at)}, ${job.city}`,
    body: [
      'An open seat matches your credentials and calendar.',
      '',
      `Setting: ${settingLabel(job.setting)}`,
      `Required credential: ${job.required_credential}`,
      `Date: ${weekdayShort(job.starts_at)}, ${monthDay(job.starts_at)}`,
      `Time: ${timeWindow(job.starts_at, job.ends_at)}`,
      `City: ${job.city}`,
      `Open seats: ${openSeatCount}`,
      '',
      `Claim a seat: ${env.publicUrl}/open-seats`,
    ].join('\n'),
  };
}

export function seatWonEmail(
  job: JobFacts,
  confirmedLabel: SeatLabel,
  to: string,
  teammate: { display_name: string } | null,
  otherSeatLabel: SeatLabel | null,
): QueuedEmail {
  const teamLine =
    teammate !== null
      ? `Teaming with: ${teammate.display_name}`
      : otherSeatLabel !== null
        ? `Seat ${otherSeatLabel} is still open`
        : 'This is a solo assignment.';
  return {
    to_address: to,
    subject: `Seat ${confirmedLabel} confirmed: ${job.reference}, ${monthDay(job.starts_at)}`,
    body: [
      `Seat ${confirmedLabel} on ${job.reference} is confirmed.`,
      '',
      `Date: ${weekdayShort(job.starts_at)}, ${monthDay(job.starts_at)}`,
      `Time: ${timeWindow(job.starts_at, job.ends_at)}`,
      `City: ${job.city}`,
      teamLine,
      '',
      `Assignment details: ${env.publicUrl}/assignments`,
    ].join('\n'),
  };
}

export function fullyStaffedEmail(
  job: JobFacts,
  to: string,
  seats: readonly { label: SeatLabel; display_name: string; credentials: readonly CredentialType[] }[],
): QueuedEmail {
  return {
    to_address: to,
    subject: `Fully staffed: ${job.reference}, ${monthDay(job.starts_at)}`,
    body: [
      `${job.reference} is fully staffed.`,
      '',
      `Date: ${weekdayShort(job.starts_at)}, ${monthDay(job.starts_at)}`,
      `Time: ${timeWindow(job.starts_at, job.ends_at)}`,
      '',
      ...seats.map(
        (seat) =>
          `Seat ${seat.label}: ${seat.display_name} (${seat.credentials.length > 0 ? seat.credentials.join(', ') : 'no current badges'})`,
      ),
    ].join('\n'),
  };
}

export function cancellationReceiptEmail(
  job: JobFacts,
  to: string,
  detail: { late: boolean; fee: string; billable_minutes: number; seats_charged: number },
): QueuedEmail {
  return {
    to_address: to,
    subject: `Cancelled: ${job.reference}, fee $${detail.fee}`,
    body: [
      `${job.reference} is cancelled.`,
      '',
      `Kind: ${detail.late ? 'Late cancellation' : 'Early cancellation'}`,
      `Fee: $${detail.fee}`,
      `Billable minutes: ${detail.billable_minutes}`,
      `Seats charged: ${detail.seats_charged}`,
      '',
      `Date: ${weekdayShort(job.starts_at)}, ${monthDay(job.starts_at)}`,
      `Time: ${timeWindow(job.starts_at, job.ends_at)}`,
    ].join('\n'),
  };
}

export function assignmentCancelledEmail(job: JobFacts, to: string): QueuedEmail {
  return {
    to_address: to,
    subject: `Assignment cancelled: ${job.reference}, ${monthDay(job.starts_at)}`,
    body: [
      `${job.reference} has been cancelled.`,
      '',
      `Date: ${weekdayShort(job.starts_at)}, ${monthDay(job.starts_at)}`,
      `Time: ${timeWindow(job.starts_at, job.ends_at)}`,
    ].join('\n'),
  };
}

export function chargesEmail(
  job: JobFacts,
  to: string,
  charge: { amount: string; billable_minutes: number; seats: number; hourly_rate: string },
): QueuedEmail {
  return {
    to_address: to,
    subject: `Charges for ${job.reference}: $${charge.amount}`,
    body: [
      `${job.reference} is closed and invoiced.`,
      '',
      `Amount: $${charge.amount}`,
      `Billable minutes: ${charge.billable_minutes}`,
      `Seats: ${charge.seats}`,
      `Hourly rate: $${charge.hourly_rate}`,
      '',
      `Invoices: ${env.publicUrl}/invoices`,
    ].join('\n'),
  };
}
