import { COPY } from '../domain/copy.js';
import { isClockTime, isIsoDate } from '../domain/time.js';
import type { Fields } from './http.js';
import { refuse } from './http.js';

export class FieldCollector {
  private readonly fields: Fields = {};

  problem(name: string, message: string): void {
    if (this.fields[name] === undefined) this.fields[name] = message;
  }

  text(body: Record<string, unknown>, name: string, message: string): string {
    const value = body[name];
    if (typeof value !== 'string' || value.trim() === '') {
      this.problem(name, message);
      return '';
    }
    return value;
  }

  optionalText(body: Record<string, unknown>, name: string): string {
    const value = body[name];
    return typeof value === 'string' ? value : '';
  }

  email(body: Record<string, unknown>, name = 'email'): string {
    const value = body[name];
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      this.problem(name, COPY.typeEmail);
      return '';
    }
    return value;
  }

  password(body: Record<string, unknown>, name: string): string {
    const value = body[name];
    if (typeof value !== 'string' || [...value].length < 10) {
      this.problem(name, COPY.typePassword);
      return '';
    }
    return value;
  }

  isoDate(body: Record<string, unknown>, name: string): string {
    const value = body[name];
    if (!isIsoDate(value)) {
      this.problem(name, COPY.typeDate);
      return '';
    }
    return value;
  }

  clockTime(body: Record<string, unknown>, name: string): string {
    const value = body[name];
    if (!isClockTime(value)) {
      this.problem(name, COPY.typeTime);
      return '';
    }
    return value;
  }

  choice<T extends string>(
    body: Record<string, unknown>,
    name: string,
    allowed: readonly T[],
  ): T {
    const value = body[name];
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.problem(name, `Pick one of ${allowed.join(', ')}.`);
      return allowed[0] as T;
    }
    return value as T;
  }

  numberChoice(body: Record<string, unknown>, name: string, allowed: readonly number[]): number {
    const value = body[name];
    if (typeof value !== 'number' || !allowed.includes(value)) {
      this.problem(name, `Pick one of ${allowed.join(', ')}.`);
      return allowed[0] as number;
    }
    return value;
  }

  wholeNumber(
    body: Record<string, unknown>,
    name: string,
    least: number,
    most: number,
  ): number {
    const value = body[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < least || value > most) {
      this.problem(name, `Pick a whole number from ${least} to ${most}.`);
      return least;
    }
    return value;
  }

  percent(body: Record<string, unknown>, name: string): number {
    const value = body[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      this.problem(name, 'Pick a percentage from 0 to 100.');
      return 0;
    }
    return Math.round(value * 10) / 10;
  }

  uuid(body: Record<string, unknown>, name: string): string {
    const value = body[name];
    if (typeof value !== 'string' || !isUuid(value)) {
      this.problem(name, 'Pick one from the list.');
      return '';
    }
    return value;
  }

  done(message?: string): void {
    if (Object.keys(this.fields).length > 0) throw refuse.fields(this.fields, message);
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** A desk's id for another desk's thing answers 404 exactly like an unknown id. */
export function requireUuidParam(value: string): string {
  if (!isUuid(value)) throw refuse.notFound();
  return value;
}

export function requireNumberParam(value: string): number {
  if (!/^\d+$/.test(value)) throw refuse.notFound();
  return Number(value);
}
