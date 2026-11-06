// Plan rules: the ritual catalogue, the field rules and the derived values.
import { isZone, pad } from './time.js';

export interface RitualSeed {
  id: string;
  title: string;
  minutes: number;
}

export const RITUAL_CATALOGUE: readonly RitualSeed[] = [
  { id: 'dim-lamps', title: 'Dim the lamps', minutes: 10 },
  { id: 'warm-shower', title: 'Warm shower', minutes: 15 },
  { id: 'paper-not-pixels', title: 'Paper, not pixels', minutes: 15 },
  { id: 'tomorrow-list', title: 'Tomorrow list', minutes: 5 },
  { id: 'slow-stretch', title: 'Slow stretch', minutes: 10 },
  { id: 'breathe', title: 'Breathe', minutes: 5 },
];

export const MAX_NOTE = 280;

export const FIELD_MESSAGES = {
  email: 'Enter an email address, like name@example.com.',
  bedtime: 'Choose a bedtime on a five-minute step, like 22:30.',
  time_zone: 'Choose a time zone from the list.',
  rituals: 'Choose between one and six rituals, 5 to 30 minutes each, 60 minutes at most in total.',
  note: 'Keep your note to 280 characters.',
  reminders: 'Choose on or paused.',
  extra: 'This field is not accepted.',
  token: 'Paste the full link from your email.',
} as const;

export function ritualTitle(id: string): string {
  return RITUAL_CATALOGUE.find((r) => r.id === id)?.title ?? id;
}

// Characters as a reader sees them: each emoji, including sequences, counts once.
export function countCharacters(text: string): number {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let n = 0;
  for (const _ of seg.segment(text)) n += 1;
  return n;
}

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return null;
  const domain = email.slice(at + 1);
  if (domain.length === 0 || !domain.includes('.')) return null;
  return email;
}

export function validBedtime(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 55 && min % 5 === 0;
}

export function validNote(raw: unknown): boolean {
  return typeof raw === 'string' && countCharacters(raw) <= MAX_NOTE;
}

export interface RitualInput {
  id: string;
  minutes: number;
}

export function validRituals(raw: unknown): RitualInput[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > 6) return null;
  const out: RitualInput[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const keys = Object.keys(item).sort();
    if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'minutes') return null;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || seen.has(r.id)) return null;
    const seed = RITUAL_CATALOGUE.find((x) => x.id === r.id);
    if (!seed) return null;
    if (typeof r.minutes !== 'number' || !Number.isInteger(r.minutes)) return null;
    if (r.minutes < 5 || r.minutes > 30 || r.minutes % 5 !== 0) return null;
    seen.add(r.id);
    total += r.minutes;
    out.push({ id: r.id, minutes: r.minutes });
  }
  if (total > 60) return null;
  return out;
}

export function totalMinutes(rituals: readonly RitualInput[]): number {
  return rituals.reduce((n, r) => n + r.minutes, 0);
}

// Bedtime minus 60 minutes on the wall clock, wrapping past midnight.
export function startsAtLocal(bedtime: string): string {
  const [h, m] = bedtime.split(':').map(Number) as [number, number];
  let t = h * 60 + m - 60;
  if (t < 0) t += 24 * 60;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

export function timeZones(): readonly string[] {
  // the browser's own list, mirrored by the server's shipped table
  return (globalThis as { Intl?: { supportedValuesOf?: (k: string) => string[] } }).Intl?.supportedValuesOf?.('timeZone')
    ?? [];
}
