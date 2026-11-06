import { config } from '../config';

/** The server's clock is the only clock: client-sent times are ignored. */
export function now(): Date {
  return new Date();
}

export function toIso(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : toIso(value);
}

export function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}

export const LOCK_TTL_SECONDS = 30;
export const PRESENCE_TTL_SECONDS = 30;
export const INVITATION_TTL_SECONDS = 7 * 86_400;
export const AGENT_TOKEN_MIN_SECONDS = 10;
export const AGENT_TOKEN_MAX_SECONDS = 365 * 86_400;
export const REVIEW_LINK_MIN_SECONDS = 10;
export const REVIEW_LINK_MAX_SECONDS = 30 * 86_400;
export const PUBLISH_MIN_SECONDS = 5;
export const PUBLISH_MAX_SECONDS = 365 * 86_400;

export function trialEndFrom(createdAt: Date): Date {
  return addSeconds(createdAt, config.time.trialLengthSeconds);
}

export function graceEndFrom(failedAt: Date): Date {
  return addSeconds(failedAt, 7 * config.time.dunningDaySeconds);
}

export function dunningStepAt(failedAt: Date, step: 0 | 3 | 7): Date {
  return addSeconds(failedAt, step * config.time.dunningDaySeconds);
}

export function tokenWarningAt(expiresAt: Date): Date {
  return addSeconds(expiresAt, -config.time.tokenWarningLeadSeconds);
}

export function withinWindow(target: Date, min: number, max: number, reference: Date): boolean {
  const delta = (target.getTime() - reference.getTime()) / 1000;
  return delta >= min && delta <= max;
}
