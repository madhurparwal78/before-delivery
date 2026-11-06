import { SETTING_LABELS } from '../../shared/contract.js';
import { formatAgencyDateTime, formatAgencyRange, formatDollars } from '../../shared/zone.js';
import type { Queryable } from '../db/pool.js';
import { qualifiedInterpreters } from '../db/users.js';
import { endInstantOf, type AssignmentRecord } from '../domain/records.js';
import { enqueueEmail } from './mail.js';

function timeRange(record: AssignmentRecord): string {
  return formatAgencyRange(record.start_at, endInstantOf(record));
}

export async function enqueueOfferEmails(db: Queryable, record: AssignmentRecord): Promise<number> {
  const interpreters = await qualifiedInterpreters(db, record.language_code);
  const subject = `Open seat ${record.number}: ${record.language_name}, ${formatAgencyDateTime(record.start_at)}`;
  const body = [
    `An interpreting seat is open for ${record.number}.`,
    '',
    `Language: ${record.language_name}`,
    `Setting: ${SETTING_LABELS[record.setting]}`,
    `City: ${record.city}`,
    `When: ${timeRange(record)} (all times Central)`,
    `Length: ${record.duration_minutes} min`,
    `Seats: ${record.seats.length}`,
    '',
    'Open Teamseat to claim a seat. Full appointment details follow once a seat is yours.',
  ].join('\n');

  for (const interpreter of interpreters) {
    await enqueueEmail(db, {
      eventKey: `offer:${record.id}:${record.offer_round}:${interpreter.id}`,
      to: interpreter.email,
      subject,
      body,
    });
  }
  return interpreters.length;
}

export async function enqueueSeatConfirmation(
  db: Queryable,
  record: AssignmentRecord,
  seatNo: number,
  holdId: number,
  interpreterEmail: string,
): Promise<void> {
  const body = [
    `Seat ${seatNo} on ${record.number} is confirmed.`,
    '',
    `Language: ${record.language_name}`,
    `Setting: ${SETTING_LABELS[record.setting]}`,
    `When: ${timeRange(record)} (all times Central)`,
    `Where: ${record.street_address}, ${record.city}`,
    `Scheduler: ${record.scheduler_name}, ${record.scheduler_phone}`,
  ].join('\n');
  await enqueueEmail(db, {
    eventKey: `claim:${holdId}`,
    to: interpreterEmail,
    subject: `Seat ${seatNo} confirmed on ${record.number}`,
    body,
  });
}

export async function enqueueCoverageReceipt(db: Queryable, record: AssignmentRecord): Promise<void> {
  const seatLines = record.seats.map((seat) => `Seat ${seat.seat_no}: ${seat.holder_initials ?? ''}`);
  const body = [
    `${record.number} is fully covered.`,
    '',
    `Language: ${record.language_name}`,
    `When: ${timeRange(record)} (all times Central)`,
    `City: ${record.city}`,
    '',
    ...seatLines,
  ].join('\n');
  await enqueueEmail(db, {
    eventKey: `covered:${record.id}:${record.coverage_round}`,
    to: record.scheduler_email,
    subject: `${record.number} is fully covered`,
    body,
  });
}

export async function enqueueCancellationNotices(
  db: Queryable,
  record: AssignmentRecord,
  feeApplies: boolean,
  feeCents: number,
  holderEmails: string[],
): Promise<void> {
  const subject = `${record.number} cancelled — ${feeApplies ? 'fee applies' : 'no fee'}`;
  const feeSentence = feeApplies
    ? `A late-cancellation fee of ${formatDollars(feeCents)} applies.`
    : 'No fee applies.';
  const body = [
    `${record.number} has been cancelled.`,
    '',
    `Language: ${record.language_name}`,
    `When: ${timeRange(record)} (all times Central)`,
    `City: ${record.city}`,
    '',
    feeSentence,
  ].join('\n');
  const recipients = [record.scheduler_email, ...holderEmails];
  for (const [index, to] of recipients.entries()) {
    await enqueueEmail(db, { eventKey: `cancelled:${record.id}:${index}:${to}`, to, subject, body });
  }
}

export async function enqueueTimeChangeNotices(
  db: Queryable,
  record: AssignmentRecord,
  changeRound: number,
  freedHolderEmails: string[],
): Promise<void> {
  const subject = `${record.number} changed — no fee`;
  const body = [
    `${record.number} has moved.`,
    '',
    `Language: ${record.language_name}`,
    `New time: ${timeRange(record)} (all times Central)`,
    `City: ${record.city}`,
    '',
    'No fee applies.',
  ].join('\n');
  const recipients = [record.scheduler_email, ...freedHolderEmails];
  for (const to of recipients) {
    await enqueueEmail(db, { eventKey: `changed:${record.id}:${changeRound}:${to}`, to, subject, body });
  }
}
