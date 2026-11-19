import { config } from './config.js';

let epoch: number; // real-time ms when the offset was set
let offsetMs: number; // business time minus real time

const parseStart = (): number => {
  if (!config.startAt) return Date.now();
  const t = Date.parse(config.startAt);
  return Number.isNaN(t) ? Date.now() : t;
};

epoch = Date.now();
offsetMs = parseStart() - epoch;

/** The one business clock. Every stored and shown time comes from here. */
export const now = (): Date => new Date(realNow() + offsetMs);

const realNow = (): number => Date.now();

export const nowIso = (): string => now().toISOString();

/** A grading move sets the clock to the given instant; it keeps running from there. */
export const moveClock = (instant: string): Date => {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return now();
  epoch = Date.now();
  offsetMs = t - epoch;
  return now();
};

export const businessMs = (): number => now().getTime();
