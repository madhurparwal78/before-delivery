import { isValidDate, isValidTime, isValidWeek } from './time.js';
import type { Sport, ThresholdKind } from './types.js';

export const MESSAGES = {
  date: 'Enter a date as YYYY-MM-DD.',
  dateFuture: 'Completed sessions cannot be in the future.',
  dateBeforeHistory: "This day is before the athlete's training history starts.",
  datePast: 'Pick today or a later day.',
  title: 'Enter a title of 1 to 80 characters.',
  startLocal: 'Enter a time as HH:MM.',
  sport: 'Choose bike or run.',
  stepsEmpty: 'Add at least one step.',
  entriesEmpty: 'Add at least one entry.',
  thresholdKind: 'Choose ftp or pace.',
  durationS: 'Enter a duration from 0:01:00 to 24:00:00.',
  avgPower: 'Enter an average power from 1 to 2000 W.',
  avgPace: 'Enter a pace from 2:00 to 20:00 per km.',
  ftp: 'Enter an FTP from 50 to 600 W.',
  pace: 'Enter a threshold pace from 2:30 to 15:00 per km.',
  coachCode: 'No coach uses that code.',
  body: 'Write a comment of 1 to 1000 characters.',
  weeks: 'A plan runs 1 to 24 weeks.',
  eventName: 'Enter an event name of 1 to 60 characters.',
  mode: 'Choose start or event.',
  week: 'Enter a week as YYYY-Www.',
  workoutIds: 'Choose planned workouts from that week.',
  noFtp: 'No FTP is set on or before this day.',
  noPace: 'No threshold pace is set on or before this day.',
} as const;

export const MANUAL_DURATION_MIN_S = 60;
export const MANUAL_DURATION_MAX_S = 86_400;
export const FTP_MIN = 50;
export const FTP_MAX = 600;
export const PACE_MIN_S = 150;
export const PACE_MAX_S = 900;
export const AVG_POWER_MIN = 1;
export const AVG_POWER_MAX = 2000;
export const AVG_PACE_MIN_S = 120;
export const AVG_PACE_MAX_S = 1200;
export const TITLE_MAX = 80;
export const EVENT_NAME_MAX = 60;
export const COMMENT_MAX = 1000;

export class Validator {
  private readonly errors = new Map<string, string>();

  add(field: string, message: string): void {
    if (!this.errors.has(field)) this.errors.set(field, message);
  }

  get failed(): boolean {
    return this.errors.size > 0;
  }

  get fields(): Record<string, string> {
    return Object.fromEntries(this.errors);
  }

  date(field: string, value: unknown): string | null {
    if (!isValidDate(value)) {
      this.add(field, MESSAGES.date);
      return null;
    }
    return value;
  }

  week(field: string, value: unknown): string | null {
    if (!isValidWeek(value)) {
      this.add(field, MESSAGES.week);
      return null;
    }
    return value;
  }

  title(field: string, value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > TITLE_MAX) {
      this.add(field, MESSAGES.title);
      return null;
    }
    return value.trim();
  }

  startLocal(field: string, value: unknown): string | null {
    if (!isValidTime(value)) {
      this.add(field, MESSAGES.startLocal);
      return null;
    }
    return value;
  }

  sport(field: string, value: unknown): Sport | null {
    if (value !== 'bike' && value !== 'run') {
      this.add(field, MESSAGES.sport);
      return null;
    }
    return value;
  }

  durationS(field: string, value: unknown): number | null {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < MANUAL_DURATION_MIN_S ||
      value > MANUAL_DURATION_MAX_S
    ) {
      this.add(field, MESSAGES.durationS);
      return null;
    }
    return value;
  }

  thresholdValue(field: string, kind: ThresholdKind, value: unknown): number | null {
    const message = kind === 'ftp' ? MESSAGES.ftp : MESSAGES.pace;
    const min = kind === 'ftp' ? FTP_MIN : PACE_MIN_S;
    const max = kind === 'ftp' ? FTP_MAX : PACE_MAX_S;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.add(field, message);
      return null;
    }
    return value;
  }

  avgPower(field: string, value: unknown): number | null {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < AVG_POWER_MIN ||
      value > AVG_POWER_MAX
    ) {
      this.add(field, MESSAGES.avgPower);
      return null;
    }
    return value;
  }

  avgPace(field: string, value: unknown): number | null {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < AVG_PACE_MIN_S ||
      value > AVG_PACE_MAX_S
    ) {
      this.add(field, MESSAGES.avgPace);
      return null;
    }
    return value;
  }

  body(field: string, value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > COMMENT_MAX) {
      this.add(field, MESSAGES.body);
      return null;
    }
    return value.trim();
  }

  eventName(field: string, value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length < 1 || value.length > EVENT_NAME_MAX) {
      this.add(field, MESSAGES.eventName);
      return null;
    }
    return value.trim();
  }
}
