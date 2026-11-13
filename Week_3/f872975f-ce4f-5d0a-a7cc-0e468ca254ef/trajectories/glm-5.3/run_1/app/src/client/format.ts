/** Length and money formatting shared by every screen. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Unit = 'mm' | 'in';

export function formatUtc(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

export function formatMm(mm: number): string {
  return `${Math.round(mm)} mm`;
}

/** Nearest sixteenth of an inch, rounded half up, as a whole number and a reduced fraction. */
export function formatIn(mm: number): string {
  // sixteenths = mm / 25.4 * 16, rounded half up
  const sixteenths = roundHalfUp(mm * 160, 254);
  if (sixteenths === 0) return '0 in';
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  if (numerator === 0) return `${whole} in`;
  let denominator = 16;
  while (numerator % 2 === 0 && denominator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const wholeText = whole === 0 ? '' : `${whole} `;
  return `${wholeText}${numerator}/${denominator} in`;
}

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (2 * denominator));
}

export function formatLength(mm: number, unit: Unit): string {
  return unit === 'mm' ? formatMm(mm) : formatIn(mm);
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export const UNIT_STORAGE_KEY = 'kerfwell-units';

export function readStoredUnit(): Unit {
  try {
    const value = window.localStorage.getItem(UNIT_STORAGE_KEY);
    return value === 'in' ? 'in' : 'mm';
  } catch {
    return 'mm';
  }
}

export function storeUnit(unit: Unit): void {
  try {
    window.localStorage.setItem(UNIT_STORAGE_KEY, unit);
  } catch {
    // storage unavailable: the choice simply does not persist
  }
}

/** Snap marks: k * 10 mm in millimetres, k * 12.7 mm rounded half up in inches. */
export function snapMark(k: number, unit: Unit): number {
  if (unit === 'mm') return k * 10;
  return Math.floor((Math.round(k * 127) * 2 + 10) / 20);
}

/** Parse a length typed in the current unit into whole millimetres, or null. */
export function parseLengthInput(text: string, unit: Unit): number | null {
  const trimmed = text.trim();
  if (unit === 'mm') {
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return inchToMmExact(trimmed);
}

/** Exact decimal inches -> millimetres, rounded half away from zero. */
export function inchToMmExact(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const [wholePart, fracPart = ''] = trimmed.split('.');
  const scale = 10 ** fracPart.length;
  const num = BigInt(wholePart || '0') * BigInt(scale) + (fracPart ? BigInt(fracPart) : 0n);
  const prod = num * 254n;
  const denom = BigInt(scale) * 10n;
  let q = prod / denom;
  const rem = prod % denom;
  if (rem * 2n >= denom) q += 1n;
  return Number(q);
}

/** Convert millimetres to a decimal-inches input value with 4 decimals trimmed. */
export function mmToInchInput(mm: number): string {
  const value = mm / 25.4;
  return String(Number(value.toFixed(4)));
}

export const STATUS_LABELS: Record<string, string> = {
  tagged: 'Tagged',
  graded: 'Graded',
  available: 'Available',
  held: 'Held',
  'sold-whole': 'Sold',
  cut: 'Cut',
};

export function holdLabel(hold: { status: string; release_reason: string | null }): string {
  if (hold.status === 'pending-payment') return 'Pending';
  if (hold.status === 'held') return 'Held';
  if (hold.status === 'converted-to-sale') return 'Bought';
  if (hold.release_reason === 'expired') return 'Expired';
  return 'Released';
}

export function ticketLabel(status: string): string {
  if (status === 'issued') return 'Issued';
  if (status === 'at-saw') return 'At saw';
  return 'Done';
}

export function boardStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
