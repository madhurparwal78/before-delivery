export const MM_PER_IN = 25.4;
export const MM2_PER_IN2 = 645.16;
export const MM3_PER_IN3 = 16387.064;

export const MAX_LENGTH_MM = 10000;
export const MAX_COORD_MM = 10000;
export const MIN_COORD_MM = -10000;

export type DisplayUnit = 'mm' | 'in';
export type Precision = 0 | 1 | 2 | 3 | 4;

export type Tolerance = {
  kind: 'symmetric' | 'asymmetric';
  plus_mm: number;
  minus_mm: number;
};

export type LengthParse =
  | { ok: true; mm: number }
  | { ok: false; reason: 'grammar' | 'range' };

const NUMBER_SOURCE = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const FRACTION_SOURCE = String.raw`(?:\d+\s*\/\s*\d+)`;
const SIGN_SOURCE = String.raw`[-\u2212]`;

const LENGTH_RE = new RegExp(
  `^\\s*(${SIGN_SOURCE})?\\s*(${FRACTION_SOURCE}|${NUMBER_SOURCE})\\s*(mm|in)?\\s*$`,
  'i',
);

function magnitudeOf(text: string): number | null {
  const slash = text.indexOf('/');
  if (slash >= 0) {
    const numerator = Number(text.slice(0, slash).trim());
    const denominator = Number(text.slice(slash + 1).trim());
    if (denominator === 0) return null;
    return numerator / denominator;
  }
  return Number(text);
}

function toMm(magnitude: number, unit: string | undefined, display: DisplayUnit): number {
  const resolved = unit ? (unit.toLowerCase() as DisplayUnit) : display;
  return resolved === 'in' ? magnitude * MM_PER_IN : magnitude;
}

export type LengthRole = 'length' | 'coordinate';

function inRange(mm: number, role: LengthRole): boolean {
  if (role === 'length') return mm > 0 && mm <= MAX_LENGTH_MM;
  return mm >= MIN_COORD_MM && mm <= MAX_COORD_MM;
}

/** Parses a request or form length field: a millimetre number or the dimension input grammar. */
export function parseLength(
  raw: unknown,
  display: DisplayUnit,
  role: LengthRole,
): LengthParse {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: 'grammar' };
    return inRange(raw, role) ? { ok: true, mm: raw } : { ok: false, reason: 'range' };
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'grammar' };
  const match = LENGTH_RE.exec(raw);
  if (!match) return { ok: false, reason: 'grammar' };
  const [, sign, digits, unit] = match;
  if (sign !== undefined && role !== 'coordinate') return { ok: false, reason: 'grammar' };
  const magnitude = magnitudeOf(digits as string);
  if (magnitude === null || !Number.isFinite(magnitude)) return { ok: false, reason: 'grammar' };
  const mm = toMm(sign === undefined ? magnitude : -magnitude, unit, display);
  return inRange(mm, role) ? { ok: true, mm } : { ok: false, reason: 'range' };
}

export function parseAngleDegrees(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const match = LENGTH_RE.exec(raw);
  if (!match || match[3] !== undefined) return null;
  const magnitude = magnitudeOf(match[2] as string);
  if (magnitude === null || !Number.isFinite(magnitude)) return null;
  return match[1] === undefined ? magnitude : -magnitude;
}

const TOLERANCE_SYMMETRIC_RE = new RegExp(
  `^\\s*(?:\\u00b1|\\+-)\\s*(${FRACTION_SOURCE}|${NUMBER_SOURCE})\\s*(mm|in)?\\s*$`,
  'i',
);
const TOLERANCE_ASYMMETRIC_RE = new RegExp(
  `^\\s*\\+\\s*(${FRACTION_SOURCE}|${NUMBER_SOURCE})\\s*\\/\\s*${SIGN_SOURCE}\\s*(${FRACTION_SOURCE}|${NUMBER_SOURCE})\\s*(mm|in)?\\s*$`,
  'i',
);

function toleranceNumber(text: string, unit: string | undefined, display: DisplayUnit): number | null {
  const magnitude = magnitudeOf(text);
  if (magnitude === null || !Number.isFinite(magnitude)) return null;
  const mm = toMm(magnitude, unit, display);
  if (mm < 0 || mm > MAX_LENGTH_MM) return null;
  return mm;
}

/** Parses the tolerance text grammar. `null` means the text is not a tolerance. */
export function parseToleranceText(text: string, display: DisplayUnit): Tolerance | null | 'clear' {
  if (text.trim() === '') return 'clear';
  const symmetric = TOLERANCE_SYMMETRIC_RE.exec(text);
  if (symmetric) {
    const value = toleranceNumber(symmetric[1] as string, symmetric[2], display);
    if (value === null) return null;
    return { kind: 'symmetric', plus_mm: value, minus_mm: value };
  }
  const asymmetric = TOLERANCE_ASYMMETRIC_RE.exec(text);
  if (asymmetric) {
    const unit = asymmetric[3];
    const plus = toleranceNumber(asymmetric[1] as string, unit, display);
    const minus = toleranceNumber(asymmetric[2] as string, unit, display);
    if (plus === null || minus === null) return null;
    return { kind: 'asymmetric', plus_mm: plus, minus_mm: minus };
  }
  return null;
}

export function lengthToDisplay(mm: number, unit: DisplayUnit): number {
  return unit === 'in' ? mm / MM_PER_IN : mm;
}

export function areaToDisplay(mm2: number, unit: DisplayUnit): number {
  return unit === 'in' ? mm2 / MM2_PER_IN2 : mm2;
}

export function volumeToDisplay(mm3: number, unit: DisplayUnit): number {
  return unit === 'in' ? mm3 / MM3_PER_IN3 : mm3;
}

/** Decimal text at exactly `precision` decimals, rounded half away from zero. */
export function formatFixed(value: number, precision: number): string {
  const text = value.toFixed(precision);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

export function formatLength(mm: number, unit: DisplayUnit, precision: number): string {
  return `${formatFixed(lengthToDisplay(mm, unit), precision)} ${unit}`;
}

export function formatArea(mm2: number, unit: DisplayUnit, precision: number): string {
  return `${formatFixed(areaToDisplay(mm2, unit), precision)} ${unit}\u00b2`;
}

export function formatVolume(mm3: number, unit: DisplayUnit, precision: number): string {
  return `${formatFixed(volumeToDisplay(mm3, unit), precision)} ${unit}\u00b3`;
}

export function formatMass(grams: number): string {
  return `${formatFixed(grams, 2)} g`;
}

export function formatDensity(gPerCm3: number): string {
  return `${formatFixed(gPerCm3, 2)} g/cm\u00b3`;
}

export function formatCentroid(
  centroid: { x: number; y: number; z: number },
  unit: DisplayUnit,
  precision: number,
): string {
  const parts = [centroid.x, centroid.y, centroid.z]
    .map((value) => formatFixed(lengthToDisplay(value, unit), precision))
    .join(', ');
  return `(${parts}) ${unit}`;
}

/** "<nominal> ± <t> <unit>" or "<nominal> +<plus> −<minus> <unit>"; the unit is dropped on canvas. */
export function formatDimension(
  valueMm: number,
  tolerance: Tolerance | null,
  unit: DisplayUnit,
  precision: number,
  withUnit: boolean,
): string {
  const nominal = formatFixed(lengthToDisplay(valueMm, unit), precision);
  const suffix = withUnit ? ` ${unit}` : '';
  if (!tolerance) return `${nominal}${suffix}`;
  if (tolerance.kind === 'symmetric') {
    const t = formatFixed(lengthToDisplay(tolerance.plus_mm, unit), precision);
    return `${nominal} \u00b1 ${t}${suffix}`;
  }
  const plus = formatFixed(lengthToDisplay(tolerance.plus_mm, unit), precision);
  const minus = formatFixed(lengthToDisplay(tolerance.minus_mm, unit), precision);
  return `${nominal} +${plus} \u2212${minus}${suffix}`;
}

/** Text for a tolerance field, in the grammar the server accepts back. */
export function toleranceToText(
  tolerance: Tolerance | null,
  unit: DisplayUnit,
  precision: number,
): string {
  if (!tolerance) return '';
  const plus = formatFixed(lengthToDisplay(tolerance.plus_mm, unit), precision);
  if (tolerance.kind === 'symmetric') return `\u00b1${plus}`;
  const minus = formatFixed(lengthToDisplay(tolerance.minus_mm, unit), precision);
  return `+${plus}/\u2212${minus}`;
}
