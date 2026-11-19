/** Member validation: field copy is published once; these helpers pick which copy a problem gets. */
import type { FieldErrors } from "./errors.js";
import { FIELD, textLengthCopy, wholeNumberCopy } from "../shared/copy.js";

export type Body = Record<string, unknown>;

const missing = (value: unknown): boolean => value === undefined || value === null;
const codePoints = (text: string): number => [...text].length;

/** Text within [min, max] code points. A missing required member answers `Required.`; an optional one (min 0) is skipped. */
export function text(errors: FieldErrors, body: Body, name: string, min: number, max: number): string | undefined {
  const value = body[name];
  if (missing(value)) {
    if (min > 0) errors.add(name, FIELD.required);
    return min === 0 ? "" : undefined;
  }
  if (typeof value !== "string" || codePoints(value) < min || codePoints(value) > max) {
    errors.add(name, textLengthCopy(min, max));
    return undefined;
  }
  return value;
}

export function wholeNumber(errors: FieldErrors, body: Body, name: string, min: number, max: number): number | undefined {
  const value = body[name];
  if (missing(value)) {
    errors.add(name, FIELD.required);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.add(name, wholeNumberCopy(min, max));
    return undefined;
  }
  return value;
}

/** A reason of 1 to 200 characters; the copy depends on what the reason is for. */
export function reason(errors: FieldErrors, body: Body, name: string, missingCopy: string): string | undefined {
  const value = body[name];
  if (missing(value) || (typeof value === "string" && value.length === 0)) {
    errors.add(name, missingCopy);
    return undefined;
  }
  if (typeof value !== "string" || codePoints(value) > 200) {
    errors.add(name, FIELD.reasonLong);
    return undefined;
  }
  return value;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDay(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const moment = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(moment.getTime()) && moment.toISOString().slice(0, 10) === value;
}

/** A measurement day from 2020-01-01 to 2030-12-31. */
export function measuredOn(errors: FieldErrors, body: Body, name: string): string | undefined {
  const value = body[name];
  if (missing(value)) {
    errors.add(name, FIELD.required);
    return undefined;
  }
  if (typeof value !== "string" || !isCalendarDay(value) || value < "2020-01-01" || value > "2030-12-31") {
    errors.add(name, FIELD.date);
    return undefined;
  }
  return value;
}

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** An instant `YYYY-MM-DDTHH:MM:SSZ`; the caller decides whether it must lie in the future. */
function instantValue(value: unknown): Date | null {
  if (typeof value !== "string" || !INSTANT.test(value)) return null;
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) || `${moment.toISOString().slice(0, 19)}Z` !== value ? null : moment;
}

export function futureInstant(errors: FieldErrors, body: Body, name: string, at: Date, optional = false): Date | null | undefined {
  const value = body[name];
  if (missing(value) || value === "") {
    if (!optional) errors.add(name, FIELD.required);
    return optional ? null : undefined;
  }
  const moment = instantValue(value);
  if (!moment || moment.getTime() <= at.getTime()) {
    errors.add(name, FIELD.instant);
    return undefined;
  }
  return moment;
}

export function oneOf<T extends string>(errors: FieldErrors, body: Body, name: string, allowed: readonly T[], copy: string): T | undefined {
  const value = body[name];
  if (missing(value)) {
    errors.add(name, FIELD.required);
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.add(name, copy);
    return undefined;
  }
  return value as T;
}

const PRINTABLE = /^[^\p{C}]+$/u;

/** A mill lot: 1 to 20 printable characters. */
export function lot(errors: FieldErrors, body: Body): string | undefined {
  const value = body.lot;
  if (typeof value !== "string" || codePoints(value) < 1 || codePoints(value) > 20 || !PRINTABLE.test(value) || value.trim() === "") {
    errors.add("lot", FIELD.lot);
    return undefined;
  }
  return value;
}
