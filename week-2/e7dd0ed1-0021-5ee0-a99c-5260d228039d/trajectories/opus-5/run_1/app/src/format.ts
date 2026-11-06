/** The single source of the display formats used on every screen, in copy and in exports. */

export function formatCount(value: number | string | bigint): string {
  const text = typeof value === 'number' ? Math.trunc(value).toString() : value.toString();
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** `YYYY-MM-DD HH:MM:SS UTC`, the format for every time on every screen. */
export function formatTime(value: Date | string | number): string {
  const date = toDate(value);
  return `${formatTimeInput(date)} UTC`;
}

/** `YYYY-MM-DD HH:MM:SS`, the format typed into retention and expiry fields. */
export function formatTimeInput(value: Date | string | number): string {
  const date = toDate(value);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ${pad(date.getUTCHours(), 2)}:${pad(
    date.getUTCMinutes(),
    2,
  )}:${pad(date.getUTCSeconds(), 2)}`;
}

/** `YYYY-MM-DDTHH:MM:SSZ`, the API, CSV and audit-hash format. */
export function isoSecond(value: Date | string | number): string {
  const date = toDate(value);
  return `${formatTimeInput(date).replace(' ', 'T')}Z`;
}

export function compactStamp(value: Date | string | number): string {
  return isoSecond(value).replace(/[-:]/g, '');
}

export function shortVersion(versionId: string): string {
  return versionId.slice(0, 8);
}

export function shortEtag(etag: string): string {
  return etag.replace(/"/g, '').slice(0, 8);
}

export function formatPercent(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function regionCountLabel(count: number): string {
  return count === 1 ? '1 region' : `${formatCount(count)} regions`;
}

export function otherSessionsLabel(count: number): string {
  return count === 1 ? '1 other session' : `${formatCount(count)} other sessions`;
}

/** Rounds numerator/denominator half up to `places` decimals and writes it without exponent. */
export function decimalDivide(numerator: bigint, denominator: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scaled = (absolute * scale * 2n + denominator) / (denominator * 2n);
  let text = scaled.toString().padStart(places + 1, '0');
  const whole = text.slice(0, text.length - places);
  const fraction = places > 0 ? text.slice(text.length - places).replace(/0+$/, '') : '';
  text = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

export function roundPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
