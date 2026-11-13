const HALF_EPSILON = 1e-9;
const MINUS_SIGN = '\u2212';

/** Half away from zero, treating a value within 1e-9 of a half as the half. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const absolute = Math.abs(scaled);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  const rounded = fraction >= 0.5 - HALF_EPSILON ? whole + 1 : whole;
  return (sign * rounded) / factor;
}

function fixed(value: number, decimals: number): string {
  return roundTo(value, decimals).toFixed(decimals);
}

export function formatTss(value: number): string {
  return fixed(value, 1);
}

export function formatIf(value: number): string {
  return fixed(value, 2);
}

export function formatWatts(value: number): string {
  return String(roundTo(value, 0));
}

export function formatPercent(value: number): string {
  return String(roundTo(value, 0));
}

/** Form (TSB): one decimal, signed, with a true minus sign and 0.0 for zero. */
export function formatTsb(value: number): string {
  const rounded = roundTo(value, 1);
  if (rounded === 0) return '0.0';
  if (rounded < 0) return `${MINUS_SIGN}${Math.abs(rounded).toFixed(1)}`;
  return `+${rounded.toFixed(1)}`;
}

/** The value behind a displayed number: same rounding, ASCII minus, no plus, no unit. */
export function dataNumber(value: number, decimals: number): string {
  const rounded = roundTo(value, decimals);
  if (rounded === 0) return (0).toFixed(decimals);
  return rounded.toFixed(decimals);
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatPace(secondsPerKm: number): string {
  const total = roundTo(secondsPerKm, 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseDurationText(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parsePaceText(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
