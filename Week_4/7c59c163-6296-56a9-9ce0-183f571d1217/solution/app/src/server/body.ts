import { invalid } from "./errors.js";

// Strict request bodies: every listed endpoint accepts only its listed fields.

type Fields = Record<string, unknown>;

export class Check {
  readonly errors: Record<string, string> = {};
  readonly body: Fields;

  constructor(raw: unknown, allowed: readonly string[], extra: Record<string, string> = {}) {
    this.body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Fields) : {};
    for (const key of Object.keys(this.body)) if (!allowed.includes(key)) this.errors[key] = "unknown_field";
    Object.assign(this.errors, extra);
  }

  fail(field: string, code: string): void {
    this.errors[field] ??= code;
  }

  int(field: string, min: number, max: number): number {
    const value = this.body[field];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.fail(field, "invalid");
      return 0;
    }
    if (value < min || value > max) this.fail(field, "out_of_range");
    return value;
  }

  text(field: string, min: number, max: number, trim = true): string {
    const value = this.body[field];
    if (typeof value !== "string") {
      this.fail(field, "invalid");
      return "";
    }
    const text = trim ? value.trim() : value;
    if ([...text].length < min || [...text].length > max) this.fail(field, "invalid");
    return text;
  }

  oneOf<T extends string>(field: string, options: readonly T[]): T {
    const value = this.body[field];
    if (typeof value !== "string" || !options.includes(value as T)) {
      this.fail(field, "invalid");
      return options[0] as T;
    }
    return value as T;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Step 8 of the precedence: answer 422 with every field error collected so far. */
  done(): void {
    if (!this.ok) throw invalid(this.errors);
  }
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
