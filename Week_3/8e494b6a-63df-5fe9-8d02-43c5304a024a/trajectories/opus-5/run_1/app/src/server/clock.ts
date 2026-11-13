import { settings } from './env.js';

const GRADING_START_MS = Date.parse('2026-03-01T00:00:00.000Z');

let gradingNowMs = GRADING_START_MS;

/** The server clock. Under grading it stands still until a grading route moves it. */
export function nowMs(): number {
  return settings.grading ? gradingNowMs : Date.now();
}

export function setClock(ms: number): void {
  gradingNowMs = ms;
}

export function advanceClock(ms: number): void {
  gradingNowMs += ms;
}

export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

export function nowIso(): string {
  return isoOf(nowMs());
}
