import { formatDollars } from '../../shared/money.js';
import { EVENT } from '../../shared/event.js';
import { newId } from '../db/ids.js';
import type { Queryable } from '../db/pool.js';

const SIGN_OFF = `\nOpen your seat at /account.\n\n${EVENT.site} — ${EVENT.provider}`;

async function queue(
  client: Queryable,
  dedupeKey: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  await client.query(
    `insert into mail_queue (id, dedupe_key, to_email, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (dedupe_key) do nothing`,
    [newId('mail'), dedupeKey, to, subject, body],
  );
}

export interface SeatLine {
  readonly bench: string;
  readonly name: string | null;
}

export async function queueDepositReceipt(
  client: Queryable,
  reservationId: string,
  to: string,
  bench: string,
  amountCents: number,
): Promise<void> {
  await queue(
    client,
    `deposit-receipt-${reservationId}`,
    to,
    `Deposit received: Bench ${bench} is yours`,
    `We received your deposit of $${formatDollars(amountCents)} for Bench ${bench} at ${EVENT.courseTitle}, ${EVENT.dates}.${SIGN_OFF}`,
  );
}

export async function queuePaidInFullReceipt(
  client: Queryable,
  reservationId: string,
  kind: 'balance' | 'full',
  to: string,
  bench: string,
  amountCents: number,
): Promise<void> {
  await queue(
    client,
    `${kind}-receipt-${reservationId}`,
    to,
    `Paid in full: Bench ${bench}`,
    `Bench ${bench} is paid in full. We received $${formatDollars(amountCents)}.${SIGN_OFF}`,
  );
}

export async function queueUpgradeReceipt(
  client: Queryable,
  reservationId: string,
  to: string,
  bench: string,
  amountCents: number,
): Promise<void> {
  await queue(
    client,
    `upgrade-receipt-${reservationId}`,
    to,
    `Upgrade confirmed: Bench ${bench} is Atelier`,
    `Bench ${bench} is now an Atelier bench. We charged $${formatDollars(amountCents)} of the difference.${SIGN_OFF}`,
  );
}

export async function queueGroupReceipt(
  client: Queryable,
  groupId: string,
  to: string,
  seats: readonly SeatLine[],
  totalCents: number,
): Promise<void> {
  const lines = seats.map((seat) => `Bench ${seat.bench}: ${seat.name ?? 'Unassigned'}`).join('\n');
  await queue(
    client,
    `group-receipt-${groupId}`,
    to,
    `Group invoice paid: ${seats.length} seats`,
    `Your group invoice of $${formatDollars(totalCents)} is paid in full.\n\n${lines}${SIGN_OFF}`,
  );
}

export async function queueBalanceReminder(
  client: Queryable,
  reservationId: string,
  kind: '21' | '7',
  to: string,
  bench: string,
  balanceCents: number,
): Promise<void> {
  await queue(
    client,
    `reminder-${kind}-${reservationId}`,
    to,
    `Balance reminder: ${kind} days to pay for Bench ${bench}`,
    `Bench ${bench} still owes $${formatDollars(balanceCents)}. The balance is due on 19 March 2027.${SIGN_OFF}`,
  );
}

export async function queueWaitlistOffer(
  client: Queryable,
  offerId: string,
  to: string,
  bench: string,
): Promise<void> {
  await queue(
    client,
    `offer-${offerId}`,
    to,
    'A bench is open for you: sign in to accept',
    `Bench ${bench} is waiting for you. Sign in to accept it before the offer passes to the next person.${SIGN_OFF}`,
  );
}

export async function queueSeatAssignment(
  client: Queryable,
  reservationId: string,
  assignmentSeq: string,
  to: string,
  buyerLabel: string,
  bench: string,
): Promise<void> {
  await queue(
    client,
    `assignment-${reservationId}-${assignmentSeq}`,
    to,
    `${buyerLabel} assigned you Bench ${bench} at ${EVENT.site}`,
    `${buyerLabel} assigned you Bench ${bench} at ${EVENT.courseTitle}, ${EVENT.dates}. Create an account with this email address to accept the seat.${SIGN_OFF}`,
  );
}

export async function queueVisaLetter(
  client: Queryable,
  reservationId: string,
  to: string,
): Promise<void> {
  await queue(
    client,
    `visa-letter-${reservationId}`,
    to,
    `Your visa-support letter for ${EVENT.site}`,
    `Your visa-support letter is ready to download.${SIGN_OFF}`,
  );
}

export async function queueRefundConfirmed(
  client: Queryable,
  reservationId: string,
  to: string,
  bench: string,
  amountCents: number,
  remainingSeats: readonly SeatLine[] | null,
): Promise<void> {
  const remaining =
    remainingSeats === null || remainingSeats.length === 0
      ? ''
      : `\n\nSeats still on your invoice:\n${remainingSeats
          .map((seat) => `Bench ${seat.bench}: ${seat.name ?? 'Unassigned'}`)
          .join('\n')}`;
  await queue(
    client,
    `refund-${reservationId}`,
    to,
    `Refund confirmed: Bench ${bench}`,
    `We refunded $${formatDollars(amountCents)} for Bench ${bench}.${remaining}${SIGN_OFF}`,
  );
}

export async function queueCertificate(
  client: Queryable,
  reservationId: string,
  to: string,
): Promise<void> {
  await queue(
    client,
    `certificate-${reservationId}`,
    to,
    `Your CE certificate for ${EVENT.site}`,
    `Your ${EVENT.credits} credit certificate for ${EVENT.courseTitle} is ready to download.${SIGN_OFF}`,
  );
}
