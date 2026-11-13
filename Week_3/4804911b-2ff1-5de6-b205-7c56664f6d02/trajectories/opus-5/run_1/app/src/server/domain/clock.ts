import { config } from '../config.js';
import { kolkataDate, type IsoDate } from './dates.js';

let testInstant: Date | null = null;

export function now(): Date {
  return testInstant ?? new Date();
}

export function today(): IsoDate {
  return kolkataDate(now());
}

export function setTestClock(instant: Date): void {
  testInstant = instant;
}

export function clearTestClock(): void {
  testInstant = null;
}

export function testClockEnabled(): boolean {
  return config.testClockEnabled;
}
