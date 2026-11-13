const MINUS = '−';

/** Rounds half away from zero; a value within 1e-9 of a half counts as the half. */
function roundHalfAway(value: number, places = 0): number {
  const scale = 10 ** places;
  const rounded = Math.floor(Math.abs(value) * scale + 0.5 + 1e-9) / scale;
  return value < 0 ? -rounded : rounded;
}

/** The rounded value as plain digits with an ASCII minus, the form every `data-*` attribute holds. */
export function plainNumber(value: number, places: number): string {
  const rounded = roundHalfAway(value, places);
  return (rounded === 0 ? 0 : rounded).toFixed(places);
}

export const formatTss = (value: number): string => plainNumber(value, 1);
export const formatIf = (value: number): string => plainNumber(value, 2);
export const formatWhole = (value: number): string => plainNumber(value, 0);

export function formatTsb(value: number): string {
  const rounded = roundHalfAway(value, 1);
  if (rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(1)}`;
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPace(secondsPerKm: number): string {
  const whole = roundHalfAway(secondsPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** `H:MM:SS` text to seconds, or null when it is not that shape. */
export function parseDuration(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** `M:SS` text to seconds, or null when it is not that shape. */
export function parsePace(text: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const pluralise = (count: number, singular: string): string => (count === 1 ? singular : `${singular}s`);
