// Request body validation. Each reader records a field code (`required`, `invalid`, `too_long`,
// `out_of_range` or an endpoint's own code) and `done()` raises the 422 with every failing field.
import { validation } from "./errors.js";

export type Body = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

interface TextRule {
  min?: number;
  max: number;
  minCode?: string;
}

interface IntRule {
  min: number;
  max: number;
}

export class Fields {
  private readonly errors: Record<string, string> = {};

  constructor(private readonly body: Body) {}

  fail(field: string, code: string): void {
    this.errors[field] ??= code;
  }

  has(field: string): boolean {
    return this.body[field] !== undefined && this.body[field] !== null;
  }

  text(field: string, rule: TextRule): string {
    const value = this.body[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      this.fail(field, "required");
      return "";
    }
    if (typeof value !== "string") {
      this.fail(field, "invalid");
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length < (rule.min ?? 1)) this.fail(field, rule.minCode ?? "required");
    else if (trimmed.length > rule.max) this.fail(field, "too_long");
    return trimmed;
  }

  optionalText(field: string, max: number): string | null {
    return this.has(field) && this.body[field] !== "" ? this.text(field, { max }) : null;
  }

  email(field: string): string {
    const value = this.text(field, { max: 254 });
    if (value && !isEmail(value)) this.fail(field, "invalid");
    return value.toLowerCase();
  }

  int(field: string, rule: IntRule): number {
    const value = this.body[field];
    if (value === undefined || value === null) {
      this.fail(field, "required");
      return 0;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.fail(field, "invalid");
      return 0;
    }
    if (value < rule.min || value > rule.max) this.fail(field, "out_of_range");
    return value;
  }

  optionalInt(field: string, rule: IntRule): number | null {
    return this.has(field) ? this.int(field, rule) : null;
  }

  choice<T extends string>(field: string, options: readonly T[]): T {
    const value = this.body[field];
    if (value === undefined || value === null || value === "") {
      this.fail(field, "required");
      return options[0] as T;
    }
    if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
      this.fail(field, "invalid");
      return options[0] as T;
    }
    return value as T;
  }

  object(field: string): Body {
    const value = this.body[field];
    if (value === undefined || value === null) {
      this.fail(field, "required");
      return {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      this.fail(field, "invalid");
      return {};
    }
    return value as Body;
  }

  /** Takes a nested object's field codes, keyed by the bare field name (`number`, `postcode`). */
  merge(nested: Fields): void {
    for (const [field, code] of Object.entries(nested.errors)) this.fail(field, code);
  }

  done(): void {
    if (Object.keys(this.errors).length) throw validation(this.errors);
  }
}
