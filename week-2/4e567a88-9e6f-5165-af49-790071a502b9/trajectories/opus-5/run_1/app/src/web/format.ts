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
  'December',
];

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const doubled = numerator * 2n + (numerator >= 0n ? denominator : -denominator);
  const twice = denominator * 2n;
  const quotient = doubled / twice;
  return doubled % twice < 0n ? quotient - 1n : quotient;
}

function group(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  return out;
}

/** Credits with two decimals and comma thousands separators. */
export function credits(micro: number | bigint): string {
  const value = typeof micro === 'bigint' ? micro : BigInt(Math.round(micro));
  const sign = value < 0n ? '-' : '';
  const cents = roundHalfUp(value < 0n ? -value : value, 10000n);
  return `${sign}${group((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function wholeCredits(value: number): string {
  return group(Math.trunc(Math.abs(value)).toString());
}

export function rate(microPerUnit: number): string {
  const value = BigInt(Math.round(microPerUnit));
  return `${group((value / 1000000n).toString())}.${(value % 1000000n).toString().padStart(6, '0')}`;
}

function fixed(unitsMicro: bigint, decimals: number): string {
  const scale = 10n ** BigInt(6 - decimals);
  const scaled = roundHalfUp(unitsMicro, scale);
  if (decimals === 0) return group(scaled.toString());
  const divisor = 10n ** BigInt(decimals);
  return `${group((scaled / divisor).toString())}.${(scaled % divisor).toString().padStart(decimals, '0')}`;
}

export function unitsMicroOf(exact: string): bigint {
  const [whole, fraction = ''] = exact.split('.');
  return BigInt(whole ?? '0') * 1000000n + BigInt((fraction + '000000').slice(0, 6));
}

/** Whole numbers for images, two decimals for megapixels, one decimal for seconds. */
export function units(exact: string, unit: string): string {
  const micro = unitsMicroOf(exact);
  if (unit === 'image') return fixed(micro, 0);
  if (unit === 'megapixel') return fixed(micro, 2);
  return fixed(micro, 1);
}

let zoneOffsetMs = 0;
let zoneName = '';

export function setOrgZone(offsetMs: number, name: string): void {
  zoneOffsetMs = offsetMs;
  if (name.length > 0) zoneName = name;
}

export function orgZoneName(): string {
  return zoneName;
}

function orgParts(iso: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(new Date(iso).getTime() + zoneOffsetMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Day, month name and year in the org time zone, for example `1 November 2026`. */
export function longDate(iso: string): string {
  const parts = orgParts(iso);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** `YYYY-MM-DD HH:MM` in the org time zone. */
export function localMinute(iso: string): string {
  const parts = orgParts(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function shortDateTime(iso: string): string {
  return localMinute(iso);
}

/** The first of the month after a period label, for example `October 2026` becomes `1 November 2026`. */
export function periodEndDate(label: string, endsAt: string): string {
  const [monthName, yearText] = label.split(' ');
  const monthIndex = MONTHS.indexOf(monthName ?? '');
  if (monthIndex < 0 || yearText === undefined) return longDate(endsAt);
  const nextMonth = (monthIndex + 1) % 12;
  const year = Number.parseInt(yearText, 10) + (nextMonth === 0 ? 1 : 0);
  return `1 ${MONTHS[nextMonth]} ${year}`;
}

export function elapsedSeconds(startedAt: string | null): string {
  if (startedAt === null) return '0s';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return `${seconds}s`;
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
