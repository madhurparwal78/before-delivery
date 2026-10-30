import { groupDigits, plainAmount } from "../../shared/format.js";
import { validation } from "./errors.js";

// Field validation with the brief's field error copy (Feedback states). One instance per request;
// `done()` throws the 422 with every collected error.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** User-perceived characters, so a joined family emoji counts as one (brief: Character limits). */
export function characters(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) count++;
  return count;
}

const LINE_BREAK = /[\r\n]/;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
const MAX_CENTS = 99_999_999_999;

interface TextRule {
  min?: number;
  max: number;
  oneLine?: boolean;
}

export class Fields {
  readonly errors: Record<string, string> = {};

  constructor(private readonly source: Record<string, unknown>) {}

  fail(field: string, copy: string): void {
    if (!(field in this.errors)) this.errors[field] = copy;
  }

  has(field: string): boolean {
    return field in this.errors;
  }

  raw(field: string): unknown {
    return this.source[field];
  }

  /** A text field kept exactly as entered. Missing or empty fails when `min` is at least 1. */
  text(field: string, label: string, rule: TextRule, value: unknown = this.source[field]): string {
    const min = rule.min ?? 1;
    if (value === undefined || value === null || value === "") {
      if (min > 0) this.fail(field, `${label} is required.`);
      return "";
    }
    if (typeof value !== "string") {
      this.fail(field, `${label} is required.`);
      return "";
    }
    if (rule.oneLine && LINE_BREAK.test(value)) this.fail(field, `${label} must be on one line.`);
    else if (characters(value) > rule.max) this.fail(field, `${label} can be at most ${groupDigits(rule.max)} characters.`);
    return value;
  }

  email(field: string, label: string, value: unknown = this.source[field]): string {
    if (value === undefined || value === null || value === "") {
      this.fail(field, `${label} is required.`);
      return "";
    }
    if (typeof value !== "string" || !EMAIL.test(value.trim())) {
      this.fail(field, "Enter an email address like name@example.com.");
      return "";
    }
    return value.trim();
  }

  /** A whole number within an inclusive range. */
  integer(field: string, label: string, min: number, max: number, value: unknown = this.source[field]): number {
    if (value === undefined || value === null || value === "") {
      this.fail(field, `${label} is required.`);
      return 0;
    }
    const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) {
      this.fail(field, `${label} must be between ${groupDigits(min)} and ${groupDigits(max)}.`);
      return 0;
    }
    return n;
  }

  /**
   * Whole cents. A value that is not a whole number of cents is a bad amount format; the browser sends
   * what was typed when it can't read it as an amount.
   */
  cents(field: string, label: string, range: { min: number; max: number; nonZero?: boolean } = { min: 1, max: MAX_CENTS },
    value: unknown = this.source[field]): number {
    if (value === undefined || value === null || value === "") {
      this.fail(field, `${label} is required.`);
      return 0;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      this.fail(field, "Enter an amount like 1250.00.");
      return 0;
    }
    if (value < range.min || value > range.max || (range.nonZero && value === 0)) {
      this.fail(field, `${label} must be between ${amountBound(range.min)} and ${amountBound(range.max)}.`);
      return 0;
    }
    return value;
  }

  /** A calendar date `YYYY-MM-DD` that exists. */
  date(field: string, label: string, value: unknown = this.source[field]): string {
    if (value === undefined || value === null || value === "") {
      this.fail(field, `${label} is required.`);
      return "";
    }
    if (typeof value !== "string" || !isCalendarDate(value)) {
      this.fail(field, `${label} must be a date like 2026-11-03.`);
      return "";
    }
    return value;
  }

  oneOf<T extends string>(field: string, label: string, allowed: readonly T[], value: unknown = this.source[field]): T {
    if (value === undefined || value === null || value === "") {
      this.fail(field, `${label} is required.`);
      return allowed[0];
    }
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      this.fail(field, `${label} must be one of ${allowed.join(", ")}.`);
      return allowed[0];
    }
    return value as T;
  }

  done(): void {
    if (Object.keys(this.errors).length) throw validation(this.errors);
  }
}

function amountBound(cents: number): string {
  const [whole, fraction] = plainAmount(cents).split(".");
  return `${whole.startsWith("-") ? "-" : ""}${groupDigits(Math.abs(Number(whole)))}.${fraction}`;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** The object behind a JSON body, or an empty one when the body is a JSON value of another kind. */
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
