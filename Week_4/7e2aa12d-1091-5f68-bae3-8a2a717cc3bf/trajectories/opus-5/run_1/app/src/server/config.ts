import type { Limits } from '../shared/types.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} is not a whole number`);
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  gradingKey: process.env['GRADING_KEY'] ?? null,
  presenceSeconds: whole('PRESENCE_SECONDS', 30),
  port: whole('APP_PUBLIC_PORT', 4173),
};

export const limits: Limits = {
  maxTracks: whole('MAX_TRACKS', 12),
  maxBreakpoints: whole('MAX_BREAKPOINTS', 3),
};
