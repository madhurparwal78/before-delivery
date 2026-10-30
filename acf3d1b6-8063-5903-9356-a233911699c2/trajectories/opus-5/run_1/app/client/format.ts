import { PlanId, planById } from '../shared/catalog';

export function credits(amount: number): string {
  return amount.toLocaleString('en-US');
}

export function creditWords(amount: number): string {
  return `${credits(amount)} credits`;
}

export function signedCredits(amount: number): string {
  return `${amount >= 0 ? '+' : '-'}${credits(Math.abs(amount))}`;
}

export function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export function longDate(value: string | Date): string {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function stampUtc(value: string | Date): string {
  const date = new Date(value);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${longDate(date)}, ${hours}:${minutes} UTC`;
}

export function dayHeading(value: string | Date): string {
  const date = new Date(value);
  const today = new Date();
  const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const difference = (dayStart(today) - dayStart(date)) / 86400000;
  if (difference <= 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return longDate(date);
}

export function planLine(plan: PlanId): string {
  const found = planById(plan)!;
  if (plan === 'free') return `${found.name}, ${credits(found.credits!)} credits once`;
  if (plan === 'team') return `${found.name}, ${credits(found.credits!)} credits per seat`;
  return `${found.name}, ${credits(found.credits!)} credits a month`;
}

export const ENTRY_KINDS: Record<string, string> = {
  plan: 'Plan credits',
  seat: 'Seat added',
  charge: 'Generation',
  refund: 'Refund'
};

export const STATUS_WORDS: Record<string, string> = {
  queued: 'Queued',
  rendering: 'Rendering',
  ready: 'Ready',
  cancelled: 'Cancelled'
};
