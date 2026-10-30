import type { Transaction } from '../db/pool.js';
import { endOf } from '../domain/assignment.js';
import { formatDollars } from '../../shared/money.js';
import { formatCentralDateTime, formatCentralRange } from '../../shared/centralTime.js';
import type { AssignmentRecord } from '../domain/types.js';
import { SETTINGS, nameOf } from '../../shared/catalog.js';
import type { OutboundEmail } from './mail.js';

function when(assignment: AssignmentRecord): string {
  return `${formatCentralRange(assignment.startAt, endOf(assignment))} (${assignment.durationMinutes} min, Central)`;
}

function seatSummary(assignment: AssignmentRecord): string {
  return assignment.seats
    .map((seat) => `Seat ${seat.seat}: ${seat.holderInitials ?? 'open'}`)
    .join('\n');
}

export async function offerNotices(
  tx: Transaction,
  assignment: AssignmentRecord,
  round: number,
): Promise<OutboundEmail[]> {
  const recipients = await tx.query<{ id: string; email: string }>(
    `select u.id, u.email from users u
     join interpreter_languages il on il.user_id = u.id
     where u.role = 'interpreter' and u.active and il.language_code = $1
     order by u.name`,
    [assignment.languageCode],
  );
  const openSeats = assignment.seats.filter((seat) => seat.status === 'open').length;
  const body = [
    'A seat is open for claims.',
    '',
    `Assignment: ${assignment.number}`,
    `Language: ${assignment.languageName}`,
    `Setting: ${nameOf(SETTINGS, assignment.setting)}`,
    `City: ${assignment.city}`,
    `When: ${when(assignment)}`,
    `Seats: ${assignment.seatCount} (${openSeats} open)`,
    '',
    'Open seats in Teamseat shows the lanes you can claim.',
  ].join('\n');
  return recipients.map((recipient) => ({
    eventKey: `offer:${assignment.id}:${round}:${recipient.id}`,
    to: recipient.email,
    subject: `Open seat ${assignment.number}: ${assignment.languageName}, ${formatCentralDateTime(assignment.startAt)}`,
    body,
  }));
}

export async function claimNotice(
  tx: Transaction,
  assignment: AssignmentRecord,
  seat: number,
  holdId: number,
  interpreterId: string,
): Promise<OutboundEmail[]> {
  const rows = await tx.query<{ email: string }>('select email from users where id = $1', [
    interpreterId,
  ]);
  const email = rows[0]?.email;
  if (email === undefined) return [];
  const body = [
    `Seat ${seat} on ${assignment.number} is confirmed for you.`,
    '',
    `Language: ${assignment.languageName}`,
    `Setting: ${nameOf(SETTINGS, assignment.setting)}`,
    `When: ${when(assignment)}`,
    `Address: ${assignment.streetAddress}, ${assignment.city}`,
    `Scheduler: ${assignment.schedulerName}, ${assignment.schedulerPhone}`,
  ].join('\n');
  return [
    {
      eventKey: `claim:${assignment.id}:${seat}:${holdId}`,
      to: email,
      subject: `Seat ${seat} confirmed on ${assignment.number}`,
      body,
    },
  ];
}

export async function coverageNotice(
  tx: Transaction,
  assignment: AssignmentRecord,
  round: number,
): Promise<OutboundEmail[]> {
  const rows = await tx.query<{ email: string }>('select email from users where id = $1', [
    assignment.schedulerId,
  ]);
  const email = rows[0]?.email;
  if (email === undefined) return [];
  const body = [
    `${assignment.number} has an interpreter on every seat.`,
    '',
    `Language: ${assignment.languageName}`,
    `When: ${when(assignment)}`,
    '',
    seatSummary(assignment),
  ].join('\n');
  return [
    {
      eventKey: `covered:${assignment.id}:${round}`,
      to: email,
      subject: `${assignment.number} is fully covered`,
      body,
    },
  ];
}

export async function cancellationNotices(
  tx: Transaction,
  assignment: AssignmentRecord,
  holderIds: readonly string[],
  feeApplies: boolean,
  feeCents: number,
): Promise<OutboundEmail[]> {
  const ids = [assignment.schedulerId, ...holderIds];
  const rows = await tx.query<{ id: string; email: string }>(
    'select id, email from users where id = any($1::uuid[])',
    [`{${ids.join(',')}}`],
  );
  const feeLine = feeApplies
    ? `A late-cancellation fee of ${formatDollars(feeCents)} applies.`
    : 'No fee applies.';
  const body = [
    `${assignment.number} is cancelled.`,
    '',
    `Language: ${assignment.languageName}`,
    `When: ${when(assignment)}`,
    '',
    feeLine,
  ].join('\n');
  const subject = `${assignment.number} cancelled — ${feeApplies ? 'fee applies' : 'no fee'}`;
  return rows.map((row) => ({
    eventKey: `cancel:${assignment.id}:${row.id}`,
    to: row.email,
    subject,
    body,
  }));
}

export async function changeNotices(
  tx: Transaction,
  assignment: AssignmentRecord,
  freedHolderIds: readonly string[],
  round: number,
): Promise<OutboundEmail[]> {
  const ids = [assignment.schedulerId, ...freedHolderIds];
  const rows = await tx.query<{ id: string; email: string }>(
    'select id, email from users where id = any($1::uuid[])',
    [`{${ids.join(',')}}`],
  );
  const body = [
    `${assignment.number} has a new time.`,
    '',
    `Language: ${assignment.languageName}`,
    `New time: ${when(assignment)}`,
    '',
    'Seats were reopened for claims.',
    'No fee applies.',
  ].join('\n');
  return rows.map((row) => ({
    eventKey: `change:${assignment.id}:${round}:${row.id}`,
    to: row.email,
    subject: `${assignment.number} changed — no fee`,
    body,
  }));
}
