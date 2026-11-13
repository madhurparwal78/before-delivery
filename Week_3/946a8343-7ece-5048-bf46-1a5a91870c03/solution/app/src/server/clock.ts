// The server clock: real time, or the grading clock (starts at 2026-01-01T00:00:00Z, moves only through the clock route).
import { config } from "./config.ts";

const GRADING_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
let gradingNowMs = GRADING_START_MS;

export function now(): number {
  return config.grading ? gradingNowMs : Date.now();
}

export function setGradingClock(ms: number): void {
  gradingNowMs = ms;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function nowSeconds(): number {
  return Math.floor(now() / 1000);
}
