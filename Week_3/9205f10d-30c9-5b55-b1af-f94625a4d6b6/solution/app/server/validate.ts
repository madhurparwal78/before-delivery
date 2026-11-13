/** Field validation for request bodies. Each check records one message per field. */
import { type WallClock, fromWallClock, parseIsoDate } from "../shared/agencyTime.js";
import type { FieldErrors } from "./errors.js";

export class Fields {
  readonly errors: FieldErrors = {};

  constructor(private readonly body: Record<string, unknown>) {}

  has(name: string): boolean {
    return this.body[name] !== undefined;
  }

  value(name: string): unknown {
    return this.body[name];
  }

  fail(name: string, message: string): void {
    this.errors[name] ??= message;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** A trimmed string of min..max characters, or undefined (with an error recorded). */
  text(name: string, min: number, max: number, message: string): string | undefined {
    const value = this.body[name];
    if (typeof value !== "string") {
      this.fail(name, message);
      return undefined;
    }
    const trimmed = value.trim();
    const length = [...trimmed].length;
    if (length < min || length > max) {
      this.fail(name, message);
      return undefined;
    }
    return trimmed;
  }

  integer(name: string, min: number, max: number, message: string): number | undefined {
    const value = this.body[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      this.fail(name, message);
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(name: string, options: readonly T[], message: string): T | undefined {
    const value = this.body[name];
    const match = options.find((option) => option === value);
    if (match === undefined) this.fail(name, message);
    return match;
  }
}

/**
 * A local agency wall-clock start (YYYY-MM-DDTHH:MM): a real date and time that exists in the
 * agency zone (a repeated time means its first occurrence) and is later than now.
 */
export function agencyStart(fields: Fields, name: string): Date | undefined {
  const raw = fields.value(name);
  const match = typeof raw === "string" ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(raw) : null;
  const date = match ? parseIsoDate(match[1] ?? "") : null;
  const hour = Number(match?.[2]);
  const minute = Number(match?.[3]);
  if (!match || !date || hour > 23 || minute > 59) {
    fields.fail(name, "Enter the start as a date and time, YYYY-MM-DDTHH:MM, in agency time.");
    return undefined;
  }
  const wall: WallClock = { ...date, hour, minute };
  const instant = fromWallClock(wall);
  if (!instant) {
    fields.fail(name, "That time doesn't exist: clocks spring forward that night. Choose another start time.");
    return undefined;
  }
  if (instant.getTime() <= Date.now()) {
    fields.fail(name, "Choose a start time later than now.");
    return undefined;
  }
  return instant;
}
