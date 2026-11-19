import type { DisplayUnits } from './protocol.js';

export const MM_PER_INCH = 25.4;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Inches rounded to the nearest eighth, printed as a reduced mixed fraction. */
export function formatInches(mm: number): string {
  const sign = mm < 0 ? '-' : '';
  const eighths = Math.round((Math.abs(mm) / MM_PER_INCH) * 8);
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (rest === 0) return `${sign}${whole} in`;
  const divisor = gcd(rest, 8);
  const fraction = `${rest / divisor}/${8 / divisor}`;
  return whole === 0 ? `${sign}${fraction} in` : `${sign}${whole} ${fraction} in`;
}

export function formatMillimetres(mm: number): string {
  return `${mm} mm`;
}

export function formatLength(mm: number, units: DisplayUnits): string {
  return units === 'in' ? formatInches(mm) : formatMillimetres(mm);
}

/** Tenths of a percent printed with exactly one decimal. */
export function formatGradeTenths(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

function trimDecimals(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** The editable value for a length spinbutton in the workspace's display units. */
export function lengthToInput(mm: number, units: DisplayUnits): string {
  return units === 'in' ? trimDecimals(mm / MM_PER_INCH, 3) : String(Math.round(mm));
}

/** The stored integer millimetres for a length spinbutton value. */
export function lengthFromInput(value: number, units: DisplayUnits): number {
  return units === 'in' ? Math.round(value * MM_PER_INCH) : Math.round(value);
}

/** The editable value for the elevation step, stored in hundredths of a millimetre. */
export function elevationStepToInput(hundredths: number, units: DisplayUnits): string {
  return units === 'in'
    ? trimDecimals(hundredths / 100 / MM_PER_INCH, 3)
    : trimDecimals(hundredths / 100, 2);
}

export function elevationStepFromInput(value: number, units: DisplayUnits): number {
  return units === 'in' ? Math.round(value * MM_PER_INCH * 100) : Math.round(value * 100);
}

export function fastClockLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}
