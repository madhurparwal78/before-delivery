/** Rounds half away from zero to the given number of decimals. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return rounded / factor;
}

/** Formats a number to fixed decimals, rounding half away from zero, with -0 shown as 0. */
export function fixed(value: number, decimals: number): string {
  const rounded = roundTo(value, decimals);
  const safe = rounded === 0 ? 0 : rounded;
  return safe.toFixed(decimals);
}

export const num2 = (v: number): string => fixed(v, 2);
export const num3 = (v: number): string => fixed(v, 3);
export const num4 = (v: number): string => fixed(v, 4);
export const whole = (v: number): string => fixed(v, 0);

/** Property values are stored to 3 decimals. */
export function storeNumber(value: number): number {
  return roundTo(value, 3);
}

export function timeReadout(frame: number): string {
  const ms = Math.round((frame * 1000) / 60);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function normaliseColour(input: string): string {
  return `#${input.replace(/^#/, '').toUpperCase()}`;
}

export function isColour(input: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(input);
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

export function megabytes(bytes: number): string {
  return fixed(bytes / 1048576, 1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
  };
}

export function formatDate(iso: string | Date, timeZone: string): string {
  const parts = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function formatTime(iso: string | Date, timeZone: string): string {
  const parts = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, timeZone);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}
