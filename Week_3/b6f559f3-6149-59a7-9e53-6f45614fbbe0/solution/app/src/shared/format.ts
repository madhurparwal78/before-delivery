/** Number, time and date formatting rules of the brief (one place). */

/** Round half away from zero to `decimals`; negative zero reads as zero. */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  const magnitude = Math.floor(Math.abs(value) * scale + 0.5) / scale;
  const signed = value < 0 ? -magnitude : magnitude;
  return signed === 0 ? 0 : signed;
}

export function fixed(value: number, decimals: number): string {
  return roundTo(value, decimals).toFixed(decimals);
}

export function vector(decimals: number, ...values: number[]): string {
  return values.map((v) => fixed(v, decimals)).join(', ');
}

/** `MM:SS.mmm` for a frame at 60 frames per second. */
export function timeReadout(frame: number): string {
  const ms = Math.floor((frame * 1000) / 60 + 0.5);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor(ms / 1000) % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export const FRAMES_PER_SECOND = 60;

export function framesIn(durationMs: number): number {
  return Math.floor((durationMs * FRAMES_PER_SECOND) / 1000 + 0.5);
}

export function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function parseHex(colour: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) as [number, number, number];
}

export const COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function normaliseColour(colour: string): string {
  return colour.toUpperCase();
}

export function formatDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(
    new Date(iso),
  );
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('day')} ${pick('month')} ${pick('year')}`;
}

export function formatClock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')}`;
}
