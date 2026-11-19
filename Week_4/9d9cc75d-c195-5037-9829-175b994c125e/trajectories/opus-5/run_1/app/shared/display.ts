export function roundHalfAway(x: number, dp: number): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const shifted = Number(`${a}e${dp}`);
  const rounded = Math.round(shifted);
  return sign * Number(`${rounded}e${-dp}`);
}

/** Every computed value is rounded to 9 decimals before any display rounding. */
export function calcRound(x: number): number {
  return roundHalfAway(x, 9);
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function plain(x: number, dp: number): string {
  const r = roundHalfAway(x, dp);
  const neg = r < 0;
  const a = Math.abs(r);
  let text = a.toFixed(dp);
  if (dp > 0) text = text.replace(/\.?0+$/, '');
  return (neg && Number(text) !== 0 ? '-' : '') + text;
}

export function displayNumber(x: number): string {
  const text = plain(x, 2);
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const [int, frac] = body.split('.');
  return `${neg ? '-' : ''}${groupThousands(int)}${frac ? `.${frac}` : ''}`;
}

export function displayShare(fraction: number): string {
  return `${plain(fraction * 100, 1)}%`;
}

export function dataValue(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '';
  return plain(x, 4);
}

export type CellValue = string | number | boolean | null;

export function displayValue(v: CellValue, isShare = false): string {
  if (v === null) return '(null)';
  if (typeof v === 'number') return isShare ? displayShare(v) : displayNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

export function csvNumber(x: number, isShare = false): string {
  return isShare ? displayShare(x) : plain(x, 2);
}
