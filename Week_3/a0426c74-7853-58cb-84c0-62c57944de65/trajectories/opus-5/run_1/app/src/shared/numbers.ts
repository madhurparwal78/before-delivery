export const TOLERANCE = 0.001;
export const SOLVE_TOLERANCE = 0.0001;

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.floor(scaled + 0.5 + 1e-9) / factor;
  return value < 0 ? -rounded : rounded;
}

export function round6(value: number): number {
  const rounded = round(value, 6);
  return rounded === 0 ? 0 : rounded;
}

function trimZeros(text: string): string {
  let out = text;
  if (out.includes('.')) {
    out = out.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (out === '-0' || out === '-') out = '0';
  return out;
}

/** Stored numbers, printed with trailing zeros trimmed. */
export function fmtStored(value: number): string {
  return trimZeros(round6(value).toFixed(6));
}

/** Visible text and entity labels: 3 decimals, trailing zeros trimmed. */
export function fmtDisplay(value: number): string {
  return trimZeros(round(value, 3).toFixed(3));
}

/** Angles in DIST results: 2 decimals, trimmed. */
export function fmtAngle(value: number): string {
  return trimZeros(round(value, 2).toFixed(2));
}

/** Dimension values: the style precision, trailing zeros kept. */
export function fmtPrecision(value: number, precision: number): string {
  const rounded = round(value, precision);
  const text = (rounded === 0 ? 0 : rounded).toFixed(precision);
  return Number(text) === 0 && text.startsWith('-') ? text.slice(1) : text;
}

export function fmtPoint(x: number, y: number): string {
  return `${fmtDisplay(x)},${fmtDisplay(y)}`;
}

export function near(a: number, b: number, tolerance = TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function entityCount(count: number): string {
  return plural(count, 'entity', 'entities');
}
