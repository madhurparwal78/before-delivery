import type { FiringStatus, ProfileSegment } from '../../shared/types';

const STARTING_TEMPERATURE_F = 70;

export const PROFILE_LIMITS = {
  minSegments: 1,
  maxSegments: 8,
  minRate: 1,
  maxRate: 1000,
  minTarget: 100,
  maxTarget: 2400,
  minHold: 0,
  maxHold: 600,
  minCoolDown: 1,
  maxCoolDown: 72,
} as const;

/** Firing hours of a profile: ramp time plus holds, counted from 70 degrees. */
export function firingHours(segments: ProfileSegment[]): number {
  let previous = STARTING_TEMPERATURE_F;
  let hours = 0;
  for (const segment of segments) {
    hours += Math.abs(segment.target_f - previous) / segment.rate_f_per_hour;
    hours += segment.hold_minutes / 60;
    previous = segment.target_f;
  }
  return hours;
}

export function firingHoursString(segments: ProfileSegment[]): string {
  return firingHours(segments).toFixed(4);
}

/** The firing and unload instants a start produces, from the profile snapshot. */
export function scheduleOf(args: {
  startedAt: Date;
  segments: ProfileSegment[];
  coolDownHours: number;
  firingHourSeconds: number;
}): { firingEndsAt: Date; coolUntil: Date } {
  const firingMs = firingHours(args.segments) * args.firingHourSeconds * 1000;
  const firingEndsAt = new Date(args.startedAt.getTime() + Math.round(firingMs));
  const coolMs = args.coolDownHours * args.firingHourSeconds * 1000;
  return { firingEndsAt, coolUntil: new Date(firingEndsAt.getTime() + Math.round(coolMs)) };
}

export interface FiringClock {
  startedAt: Date | null;
  firingEndsAt: Date | null;
  coolUntil: Date | null;
  unloadedAt: Date | null;
}

/** The one place a firing's status is decided, from the server's own clock. */
export function firingStatusOf(firing: FiringClock, now: Date): FiringStatus {
  if (firing.unloadedAt) return 'unloaded';
  if (!firing.startedAt || !firing.firingEndsAt || !firing.coolUntil) return 'building';
  if (now.getTime() < firing.firingEndsAt.getTime()) return 'firing';
  if (now.getTime() < firing.coolUntil.getTime()) return 'cooling';
  return 'unloadable';
}

export interface ProfileDraft {
  segments: ProfileSegment[];
  cool_down_hours: number;
}

export function validateProfile(body: {
  segments: unknown;
  cool_down_hours: unknown;
}): { draft: ProfileDraft | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const rawSegments = Array.isArray(body.segments) ? body.segments : null;
  if (
    !rawSegments ||
    rawSegments.length < PROFILE_LIMITS.minSegments ||
    rawSegments.length > PROFILE_LIMITS.maxSegments
  ) {
    fields.segments = `Enter ${PROFILE_LIMITS.minSegments} to ${PROFILE_LIMITS.maxSegments} segments`;
  }
  const segments: ProfileSegment[] = [];
  if (rawSegments) {
    rawSegments.forEach((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const rate = Number(row.rate_f_per_hour);
      const target = Number(row.target_f);
      const hold = Number(row.hold_minutes);
      if (!Number.isInteger(rate) || rate < PROFILE_LIMITS.minRate || rate > PROFILE_LIMITS.maxRate) {
        fields[`segments.${index}.rate_f_per_hour`] =
          `Enter a rate from ${PROFILE_LIMITS.minRate} to ${PROFILE_LIMITS.maxRate} °F per hour`;
      }
      if (
        !Number.isInteger(target) ||
        target < PROFILE_LIMITS.minTarget ||
        target > PROFILE_LIMITS.maxTarget
      ) {
        fields[`segments.${index}.target_f`] =
          `Enter a target from ${PROFILE_LIMITS.minTarget} to ${PROFILE_LIMITS.maxTarget} °F`;
      }
      if (!Number.isInteger(hold) || hold < PROFILE_LIMITS.minHold || hold > PROFILE_LIMITS.maxHold) {
        fields[`segments.${index}.hold_minutes`] =
          `Enter a hold from ${PROFILE_LIMITS.minHold} to ${PROFILE_LIMITS.maxHold} minutes`;
      }
      segments.push({ rate_f_per_hour: rate, target_f: target, hold_minutes: hold });
    });
  }

  const coolDown = Number(body.cool_down_hours);
  if (
    !Number.isInteger(coolDown) ||
    coolDown < PROFILE_LIMITS.minCoolDown ||
    coolDown > PROFILE_LIMITS.maxCoolDown
  ) {
    fields.cool_down_hours =
      `Enter a cool-down from ${PROFILE_LIMITS.minCoolDown} to ${PROFILE_LIMITS.maxCoolDown} hours`;
  }

  if (Object.keys(fields).length > 0) return { draft: null, fields };
  return { draft: { segments, cool_down_hours: coolDown }, fields };
}
