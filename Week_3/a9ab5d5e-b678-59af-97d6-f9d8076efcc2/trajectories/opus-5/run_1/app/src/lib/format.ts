const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const GROUP = '\u202f';
const MINUS = '\u2212';

function partsOf(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
  return { year, month, day };
}

/** `Fri 12 Jun 2026`. */
export function formatDisplayDate(date: string): string {
  const { year, month, day } = partsOf(date);
  const weekdayIndex = (((Date.UTC(year, month - 1, day) / 86400000) % 7) + 7 + 3) % 7;
  return `${weekdays[weekdayIndex] as string} ${day} ${months[month - 1] as string} ${year}`;
}

/** `12/06/2026`. */
export function formatDmy(date: string): string {
  const { year, month, day } = partsOf(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function parseDmy(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const year = Number.parseInt(match[3] as string, 10);
  if (month < 1 || month > 12 || day < 1) return null;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > length) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function groupDigits(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += GROUP;
    out += digits[index] as string;
  }
  return out;
}

/** `1 234,56 CAD`, with the currency's own decimals. */
export function formatMoney(minor: number, currency: string, exponent: number): string {
  const negative = minor < 0;
  const absolute = Math.abs(minor).toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? absolute : absolute.slice(0, absolute.length - exponent);
  const fraction = exponent === 0 ? '' : absolute.slice(absolute.length - exponent);
  const body = exponent === 0 ? groupDigits(whole) : `${groupDigits(whole)},${fraction}`;
  return `${negative ? MINUS : ''}${body} ${currency}`;
}

/** Reads the wall clock out of an RFC 3339 instant that already carries its governing offset. */
export function instantWallClock(instant: string): { date: string; time: string } {
  return { date: instant.slice(0, 10), time: instant.slice(11, 16) };
}

/** `17:00 on Fri 12 Jun 2026 (America/St_Johns)`. */
export function formatInstantDisplay(instant: string, zone: string): string {
  const { date, time } = instantWallClock(instant);
  return `${time} on ${formatDisplayDate(date)} (${zone})`;
}

export function formatDmyHm(instant: string): string {
  const { date, time } = instantWallClock(instant);
  return `${formatDmy(date)} ${time}`;
}

/** Two whole percentages that always sum to 100, the leftover point to the larger fraction. */
export function splitPercents(planningBp: number): [number, number] {
  const planningWhole = Math.floor(planningBp / 100);
  const otherWhole = Math.floor((10000 - planningBp) / 100);
  const planningFraction = planningBp % 100;
  const otherFraction = (10000 - planningBp) % 100;
  if (planningWhole + otherWhole === 100) return [planningWhole, otherWhole];
  if (otherFraction > planningFraction) return [planningWhole, otherWhole + 1];
  return [planningWhole + 1, otherWhole];
}

/** The last night of a night range as read on screen, from the API's half-open end. */
export function lastNightOf(endExclusive: string): string {
  const { year, month, day } = partsOf(endExclusive);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86400000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(
    previous.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function nextDayOf(date: string): string {
  const { year, month, day } = partsOf(date);
  const next = new Date(Date.UTC(year, month - 1, day) + 86400000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}
