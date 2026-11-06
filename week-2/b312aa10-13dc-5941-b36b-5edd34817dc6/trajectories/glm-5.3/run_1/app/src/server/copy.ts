import { formatHours, formatMoney } from './time.js';
import { monthName as monthNameOf } from './errors.js';

export interface BlockLike {
  stationName: string;
  kind: string;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
}

/** "<station> <date> <start>–<end>" for hourly blocks; "<station> <date> for <n> days" for shelves. */
export function blockLabel(block: BlockLike): string {
  if (block.kind === 'shelf') {
    return `${block.stationName} ${block.localDate} for ${block.days === 1 ? '1 day' : `${block.days} days`}`;
  }
  return `${block.stationName} ${block.localDate} ${block.localStart}–${block.localEnd}`;
}

export interface ChargeSplit {
  chargeCents: number;
  hours: number;
  peakHours: number;
}

/** Confirm success copy for the polite live region. */
export function confirmAnnouncement(
  block: BlockLike,
  split: ChargeSplit,
  balanceHours: number,
  extraWeeks: number,
  billingPending: boolean,
): string {
  let text: string;
  if (block.kind === 'shelf') {
    text = `${blockLabel(block)} booked`;
  } else {
    const leftWord = balanceHours === 1 ? 'hour' : 'hours';
    const peakClause =
      split.peakHours > 0 ? `, ${formatHours(split.peakHours)} ${split.peakHours === 1 ? 'hour' : 'hours'} at peak` : '';
    text = `${block.stationName}, ${block.localStart} to ${block.localEnd} booked, ${formatHours(balanceHours)} ${leftWord} left${peakClause}`;
  }
  if (extraWeeks > 0) text += ` and ${extraWeeks} ${extraWeeks === 1 ? 'week' : 'weeks'}`;
  if (billingPending) text += '. Billing is pending.';
  return text;
}

export function confirmEmailBody(
  business: string,
  block: BlockLike,
  bookingId: string,
  chargeCents: number,
  month: string,
  balanceHours: number | null,
): string {
  const lines = [
    `${business}`,
    `${blockLabel(block)}`,
    `Booking ${bookingId}`,
    `Charge: ${formatMoney(chargeCents)} for your ${monthNameOf(month)} statement`,
  ];
  if (balanceHours !== null && block.kind !== 'shelf') {
    lines.push(`${formatHours(balanceHours)} hours left in ${monthNameOf(month)}`);
  }
  return lines.join('\r\n');
}

export function cancelEmailBody(feeCents: number | null): string {
  return feeCents === null ? 'No cancellation fee' : `Late cancellation fee: ${formatMoney(feeCents)}`;
}

export function statementBody(month: string, business: string, lines: { description: string; amountCents: number }[], totalCents: number): string {
  const body = [`Statement for ${monthNameOf(month)}`, business, ''];
  for (const line of lines) body.push(`${line.description} ${formatMoney(line.amountCents)}`);
  body.push('');
  body.push(`Total ${formatMoney(totalCents)}`);
  return body.join('\r\n');
}
