// The server clock: the system clock, or a standing-still clock the grading routes move.
import { config } from "./config";

const GRADING_START_MS = Date.UTC(2026, 2, 1);
let gradingNow = GRADING_START_MS;

export function now(): number {
  return config.grading ? gradingNow : Date.now();
}

export function setNow(ms: number): void {
  gradingNow = ms;
}
