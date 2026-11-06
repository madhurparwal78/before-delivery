import { config } from './config.js';

const processStart = Date.now();

export function nowMs(): number {
  if (config.clockStart === null) return Date.now();
  return config.clockStart + (Date.now() - processStart);
}

export function now(): Date {
  return new Date(nowMs());
}

export function instant(value: Date): string {
  return value.toISOString();
}

export function plusSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}
