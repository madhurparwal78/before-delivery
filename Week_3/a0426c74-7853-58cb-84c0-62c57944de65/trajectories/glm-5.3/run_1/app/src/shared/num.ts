// Shared numeric helpers. Stored numbers are rounded to 6 decimals, half away from zero.
export const STORED_DECIMALS = 6;
const STORED_FACTOR = 10 ** STORED_DECIMALS;

export function round6(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = value * STORED_FACTOR;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / STORED_FACTOR;
}

export function round4(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = value * 10000;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / 10000;
}

// Trims trailing zeros from a plain decimal string.
export function trimZeros(text: string): string {
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

export function fixedDecimals(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return trimZeros(fixed);
}

export function fixedDecimalsKeep(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export function numberKey(value: number): string {
  return trimZeros(value.toFixed(STORED_DECIMALS));
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / factor;
}

export function formatInteger(value: number): string {
  return String(value);
}

export const TOLERANCE = 0.001;

export function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

export function nearlyZero(a: number): boolean {
  return Math.abs(a) <= TOLERANCE;
}

export function formatUtc(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

export function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let text = '';
  for (const b of bytes) text += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
  return `${prefix}_${text}`;
}

export function normaliseAngle(degrees: number): number {
  let a = degrees % 360;
  if (a < 0) a += 360;
  return round6(a);
}


export function round6Point(p: { x: number; y: number }): { x: number; y: number } {
  return { x: round6(p.x), y: round6(p.y) };
}
