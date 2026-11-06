export const HALF_HOUR_MS = 30 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `<signed tonnes>`: a leading `+` when positive, `-` when negative, nothing for `0.000`. */
export function signedTonnes(tonnes: string): string {
  if (tonnes.startsWith('-')) return tonnes;
  return Number(tonnes) === 0 ? tonnes : `+${tonnes}`;
}

/** `YYYY-MM-DD HH:MM UTC`, for interval bounds. */
export function intervalDisplay(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `YYYY-MM-DD HH:MM:SS UTC`, for server timestamps. */
export function checkedDisplay(stamp: string): string {
  const iso = new Date(Date.parse(stamp)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** `YYYY-MM-DD HH:MM UTC`, for link expiry. */
export function expiresDisplay(stamp: string): string {
  return intervalDisplay(Date.parse(stamp));
}

export function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `YYYYMMDDHHMM`, the compact form the workspace URL uses. */
export function compactStamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(
    14,
    16,
  )}`;
}

export function parseCompactStamp(text: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (match === null) return null;
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return Number.isFinite(ms) && compactStamp(ms) === text ? ms : null;
}

export function parseDateOnly(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) && dateOnly(ms) === text ? ms : null;
}

export function apiStamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** The visible counting numeral for coverage: one decimal with a percent sign. */
export function coverageNumeral(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** The visible counting numeral for net tonnes: three decimals with a sign. */
export function netNumeral(value: number): string {
  const text = Math.abs(value).toFixed(3);
  if (Number(text) === 0) return text;
  return value < 0 ? `-${text}` : `+${text}`;
}
