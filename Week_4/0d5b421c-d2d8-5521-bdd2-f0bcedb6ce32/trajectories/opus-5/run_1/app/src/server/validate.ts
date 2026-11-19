import { errors, type ErrorFields } from './errors';
import type { Layout, Unit } from './domain/floor';
import { isSlotTime, isDateWithinHorizon, horizonDates } from './domain/rules';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Collects every failing input so a 422 lists them all. */
export class Validator {
  private readonly fields: ErrorFields = {};

  private fail(key: string, message: string): null {
    this.fields[key] = message;
    return null;
  }

  date(key: string, value: unknown, now: Date): string | null {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
      return this.fail(key, 'Use a date like 2026-11-14.');
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return this.fail(key, 'Use a date like 2026-11-14.');
    if (!isDateWithinHorizon(value, now)) {
      const { earliest, latest } = horizonDates(now);
      return this.fail(key, `Choose a date from ${earliest} to ${latest}.`);
    }
    return value;
  }

  partyFromBody(key: string, value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 8) {
      return this.fail(key, 'Choose 1 to 8 guests.');
    }
    return value;
  }

  partyFromQuery(key: string, value: unknown): number | null {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      return this.fail(key, 'Choose 1 to 8 guests.');
    }
    const parsed = Number(value);
    if (parsed < 1 || parsed > 8) return this.fail(key, 'Choose 1 to 8 guests.');
    return parsed;
  }

  slotTime(key: string, value: unknown): string | null {
    if (typeof value !== 'string' || !isSlotTime(value)) {
      return this.fail(key, 'Choose a time from 18:00 to 22:00 on the quarter hour.');
    }
    return value;
  }

  unit(key: string, value: unknown, layout: Layout): Unit | null {
    const unit = typeof value === 'string' ? layout.unitById.get(value) : undefined;
    if (!unit) {
      this.fail(key, 'Choose a table from the floor plan.');
      return null;
    }
    return unit;
  }

  name(key: string, value: unknown): string | null {
    if (typeof value !== 'string') return this.fail(key, 'Enter your name.');
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return this.fail(key, 'Enter a name of 1 to 80 characters.');
    }
    return trimmed;
  }

  email(key: string, value: unknown): string | null {
    if (typeof value !== 'string') return this.fail(key, 'Enter a valid email address.');
    const trimmed = value.trim();
    if (trimmed.length > 254 || !EMAIL_PATTERN.test(trimmed)) {
      return this.fail(key, 'Enter a valid email address.');
    }
    return trimmed;
  }

  optionalPhone(key: string, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return this.fail(key, 'Use 32 characters or fewer.');
    if (value.length > 32) return this.fail(key, 'Use 32 characters or fewer.');
    return value;
  }

  acceptedDeposit(key: string, value: unknown, depositCents: number): boolean {
    if (depositCents <= 0) return true;
    if (value !== true) {
      this.fail(key, 'Tick the box to accept the deposit.');
      return false;
    }
    return true;
  }

  windowOrder(key: string, earliest: string | null, latest: string | null): void {
    if (earliest !== null && latest !== null && latest < earliest) {
      this.fail(key, 'Choose a latest time that is not before the earliest time.');
    }
  }

  isoInstant(key: string, value: unknown): Date | null {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      return this.fail(key, 'Use an ISO 8601 instant with an offset or Z.');
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return this.fail(key, 'Use an ISO 8601 instant with an offset or Z.');
    }
    return parsed;
  }

  /** Throws a 422 listing every failing input, or hands back the checked values. */
  finish<T extends Record<string, unknown>>(values: T): { [K in keyof T]: NonNullable<T[K]> } {
    if (Object.keys(this.fields).length > 0) throw errors.validationFailed(this.fields);
    return values as { [K in keyof T]: NonNullable<T[K]> };
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
