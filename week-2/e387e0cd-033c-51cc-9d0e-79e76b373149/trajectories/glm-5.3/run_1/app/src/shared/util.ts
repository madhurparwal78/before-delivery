// Exact-decimal utilities shared by server and client.
export { parseDecimal, formatDecimal, rescaleHalfUp, mulDecimals, eqZero, isGreaterThanZero, absCompare, scaleUp, toCentsHalfUp, centsToDecimal, multiplyCents, newDecimal, bigIntToDecimal, centsToUnitCentsDecimal } from './decimal.js';
export type { Decimal } from './decimal.js';

export const ASSET_DECIMALS: Record<string, number> = { BTC: 8, ETH: 18, USDC: 6, SOL: 9 };
export const ASSETS = ['BTC', 'ETH', 'USDC', 'SOL'] as const;

export function formatAmount(asset: string, amount: string): string {
  return `${asset} ${trimTrailingZeros(amount)}`;
}

export function trimTrailingZeros(amount: string): string {
  const dot = amount.indexOf('.');
  if (dot < 0) return amount;
  let end = amount.length;
  while (end > dot && amount[end - 1] === '0') end--;
  if (end === dot + 1) end = dot;
  return amount.slice(0, end);
}

export function formatFiat(currency: string, cents: number | bigint): string {
  const negative = typeof cents === 'bigint' ? cents < 0n : cents < 0;
  const abs = negative ? -cents : cents;
  const digits = abs.toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${negative ? '-' : ''}${grouped}.${frac}`;
}

export function centsToAmountString(cents: number | bigint): string {
  const abs = typeof cents === 'bigint' ? (cents < 0n ? -cents : cents) : Math.abs(cents);
  const digits = abs.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function formatDateTime(date: Date, timeZone: string, city: string): string {
  return `${formatDate(date, timeZone)} ${formatClock(date, timeZone)} ${city} time`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDateParts(date: Date, timeZone: string): { weekday: string; day: number; month: string; year: number } {
  const parts = partsInZone(date, timeZone);
  return { weekday: WEEKDAYS[parts.weekday], day: parts.day, month: MONTHS[parts.month - 1], year: parts.year };
}

export function formatDate(date: Date, timeZone: string): string {
  const p = formatDateParts(date, timeZone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

export function formatShortDate(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function formatClock(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.hour24}:${p.minute.toString().padStart(2, '0')}`;
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${FULL_MONTHS[Number(m) - 1]} ${y}`;
}

function partsInZone(date: Date, timeZone: string): { day: number; month: number; year: number; hour24: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) out[part.type] = part.value;
  const weekday = WEEKDAYS.indexOf(out.weekday!);
  const hour = Number(out.hour);
  return { day: Number(out.day), month: Number(out.month), year: Number(out.year), hour24: hour === 24 ? 0 : hour, minute: Number(out.minute), weekday };
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export function maskAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function initials(name: string): string {
  return name.split(/[ -]+/).filter(Boolean).map((part) => `${part[0].toUpperCase()}.`).join(' ');
}

export function maskIdentity(identityNumber: string): string {
  return `…${identityNumber.slice(-4)}`;
}
