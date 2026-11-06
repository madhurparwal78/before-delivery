import { dateLabel, dateTimeLabel, monthLabel } from '../shared/businesstime';
import { countdownLabel, maskedAddress, moneyLabel, trimAmount } from '../shared/format';

export interface BusinessClock {
  readonly timeZone: string;
  readonly city: string;
}

/** Every instant on screen is the server's instant in the workspace's business time. */
export function showDateTime(instant: string, clock: BusinessClock): string {
  return dateTimeLabel(new Date(instant), clock.timeZone, clock.city);
}

export function showDate(date: string): string {
  return dateLabel(date);
}

export function showMonth(month: string): string {
  return monthLabel(month);
}

export function showMoney(currency: string, cents: number): string {
  return moneyLabel(currency, BigInt(cents));
}

export function showCrypto(asset: string, amount: string): string {
  return `${asset} ${trimAmount(amount)}`;
}

export function showCountdown(remainingSeconds: number): string {
  return countdownLabel(remainingSeconds);
}

export function showMaskedAddress(address: string): string {
  return maskedAddress(address);
}

export function businessDateOf(instant: string, clock: BusinessClock): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: clock.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '01';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
