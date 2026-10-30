// Boundary validation: reads a request body field by field and collects the brief's field messages.
import { isCalendarDate } from "../domain/time.js";
import { invalid, NO_SUCH_RECORD } from "./errors.js";

export type JsonObject = Record<string, unknown>;

export class Fields {
  private readonly problems: Record<string, string> = {};

  constructor(private readonly source: JsonObject) {}

  has(name: string): boolean {
    return Object.hasOwn(this.source, name);
  }

  raw(name: string): unknown {
    return this.source[name];
  }

  fail(name: string, message: string): void {
    this.problems[name] ??= message;
  }

  ok(name: string): boolean {
    return !(name in this.problems);
  }

  /** A string trimmed and bounded in UTF-16 units; `message` covers missing, empty and too long. */
  text(name: string, opts: { min: number; max: number; message: string; trim?: boolean }): string {
    const value = this.source[name];
    if (typeof value !== "string") {
      this.fail(name, opts.message);
      return "";
    }
    const result = opts.trim === false ? value : value.trim();
    if (result.length < opts.min || result.length > opts.max) this.fail(name, opts.message);
    return result;
  }

  integer(name: string, min: number, max: number, message: string): number {
    const value = this.source[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      this.fail(name, message);
      return min;
    }
    return value;
  }

  oneOf<T extends string>(name: string, options: readonly T[], message: string): T {
    const value = this.source[name];
    if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T;
    this.fail(name, message);
    return options[0] as T;
  }

  boolean(name: string, message: string): boolean {
    const value = this.source[name];
    if (typeof value !== "boolean") {
      this.fail(name, message);
      return false;
    }
    return value;
  }

  /** An id that must name a record in this workspace; `known` answers whether it does. */
  id(name: string, known: (id: string) => boolean): string {
    const value = this.source[name];
    if (typeof value !== "string" || !known(value)) {
      this.fail(name, NO_SUCH_RECORD);
      return "";
    }
    return value;
  }

  /** A calendar date YYYY-MM-DD that exists. */
  date(name: string, message: string): string {
    const value = this.source[name];
    if (typeof value !== "string" || !isCalendarDate(value)) {
      this.fail(name, message);
      return "";
    }
    return value;
  }

  /** Throws 422 with every field message; otherwise hands back `values`, which the passed checks made present. */
  check<T extends Record<string, unknown>>(values?: T): { [K in keyof T]: NonNullable<T[K]> } {
    if (Object.keys(this.problems).length > 0) throw invalid(this.problems);
    return (values ?? {}) as { [K in keyof T]: NonNullable<T[K]> };
  }
}

export function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}
