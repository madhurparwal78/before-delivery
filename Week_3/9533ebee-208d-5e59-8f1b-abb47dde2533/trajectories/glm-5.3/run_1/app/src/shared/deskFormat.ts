// Desk formats: the single place that renders and parses the interface's figures.
// Amounts are integer minor units in the asset's decimals; prices are integer price units.

export const GROUP = '\u202F'; // narrow no-break space
export const MINUS = '\u2212';

export function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

/** Desk-format amount display from a signed integer of minor units. */
export function deskAmount(value: bigint, decimals: number, signed: boolean): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = abs.toString().padStart(decimals + 1, '0');
  const intPart = base.slice(0, base.length - decimals) || '0';
  const frac = base.slice(base.length - decimals);
  const body = decimals === 0 ? groupDigits(intPart) : `${groupDigits(intPart)},${frac}`;
  if (neg) return MINUS + body;
  if (signed && value > 0n) return '+' + body;
  return body;
}

/** Desk-format price display from an integer of price units (hundred-millionths of a dollar). */
export function deskPrice(value: bigint): string {
  return '$' + deskAmount(value, 8, false);
}

/** Desk-format percentage from basis points. */
export function deskPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  const wholeStr = whole.toString().replace('-', '-');
  const frac = rest.toString().padStart(2, '0');
  const negative = bps < 0;
  const sign = negative ? MINUS : '';
  return `${sign}${wholeStr},${frac}%`;
}

/** Desk-format percentage field value (no % sign) e.g. "80,00". */
export function deskPercentField(bps: number): string {
  const whole = Math.floor(Math.abs(bps) / 100).toString();
  const frac = (Math.abs(bps) % 100).toString().padStart(2, '0');
  return (bps < 0 ? MINUS : '') + whole + ',' + frac;
}

/** Health factor with exactly 4 decimals, e.g. 1.1250 in API form scaled by 10^4. */
export function deskHealthFactor(hfScaled: bigint | null): string {
  if (hfScaled === null) return 'No debt';
  return deskAmount(hfScaled, 4, false);
}

export function deskSharePrice(scaled: bigint): string {
  return deskAmount(scaled, 12, false);
}

export function deskShock(shockBps: number): string {
  const tenths = Math.round(shockBps / 5);
  const neg = tenths < 0;
  const abs = Math.abs(tenths);
  const whole = Math.floor(abs / 10);
  const frac = (abs % 10).toString();
  const sign = neg ? MINUS : tenths > 0 ? '+' : '';
  return `${sign}${whole},${frac}`;
}

export function deskDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = (s % 60).toString().padStart(2, '0');
  return `${m}:${rest}`;
}

/** Wall time HH:MM:SS <abbr> for an instant in the desk zone. */
export function deskWallTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset',
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p): boolean => p.type === t)?.value ?? '';
  const abbr = zoneAbbreviation(instant, timeZone);
  return `${get('hour')}:${get('minute')}:${get('second')} ${abbr}`;
}

/** Full desk date-time YYYY-MM-DD HH:MM:SS <abbr>. */
export function deskDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p): boolean => p.type === t)?.value ?? '';
  const abbr = zoneAbbreviation(instant, timeZone);
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${abbr}`;
}

/** The zone abbreviation for a generic zone at that instant, derived from its offset. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, timeZoneName: 'longOffset', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const offsetPart = parts.find((p): boolean => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart);
  if (match === null) return offsetPart;
  const sign = match[1];
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  const offsetMinutes = (sign === '-' ? -1 : 1) * (hours * 60 + minutes);
  return offsetFor(offsetMinutes);
}

/** Named abbreviations for the zones the desk can use; offsets keep others workable. */
function offsetFor(offsetMinutes: number): string {
  const known: Record<number, string> = {
    [-210]: 'NST', [-150]: 'NDT',
    [-300]: 'EST', [-240]: 'EDT',
    [-60]: 'BST', [0]: 'GMT',
    [60]: 'CET', [120]: 'CEST',
    [-480]: 'PST', [-420]: 'PDT',
  };
  const named = known[offsetMinutes];
  if (named !== undefined) return named;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${Math.floor(abs / 60)}:${(abs % 60).toString().padStart(2, '0')}`;
}
