import { config } from './config';

const gradingStart = Date.parse('2026-01-01T00:00:00Z');

let fixedMs = config.grading ? gradingStart : 0;

export function nowMs(): number {
  return config.grading ? fixedMs : Date.now();
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

export function setClock(ms: number): void {
  fixedMs = ms;
}

export function advanceClock(ms: number): void {
  fixedMs += ms;
}

export function nowSeconds(): number {
  return Math.floor(nowMs() / 1000);
}
