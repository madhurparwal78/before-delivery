// Field rules from the brief, each decided once: text kinds, bare addresses, integers and writable keys.

import { type FieldErrors, invalid } from "./http.js";

const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u;
const ADDRESS_FORBIDDEN = /[\s\u0000-\u001f\u007f<>,;"()]/u;

export const NOT_WRITABLE = "Field is not writable.";

/** Collects field errors for one request body; `done()` answers 422 if any were recorded. */
export class Checker {
  readonly errors: FieldErrors = {};

  constructor(readonly body: Record<string, unknown>) {}

  /** Every key outside `writable` is refused by name. */
  writable(writable: readonly string[]): this {
    for (const key of Object.keys(this.body)) {
      if (!writable.includes(key)) this.errors[key] = NOT_WRITABLE;
    }
    return this;
  }

  has(key: string): boolean {
    return Object.hasOwn(this.body, key);
  }

  error(key: string, message: string): void {
    this.errors[key] ??= message;
  }

  singleLine(key: string, min: number, max: number): string {
    return this.text(key, min, max, SINGLE_LINE_FORBIDDEN, "must be one line");
  }

  multiLine(key: string, min: number, max: number): string {
    return this.text(key, min, max, MULTI_LINE_FORBIDDEN, "contains characters that are not allowed");
  }

  address(key: string): string {
    const value = this.body[key];
    if (typeof value !== "string" || !isBareAddress(value)) {
      this.error(key, "Enter a single email address such as name@studio.example.");
      return "";
    }
    return value;
  }

  integer(key: string, min: number, max: number): number {
    const value = this.body[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
      this.error(key, `Enter a whole number from ${min} to ${max}.`);
      return min;
    }
    return value;
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) invalid(this.errors);
  }

  private text(key: string, min: number, max: number, forbidden: RegExp, rule: string): string {
    const value = this.body[key];
    if (typeof value !== "string") {
      this.error(key, "This field is required.");
      return "";
    }
    const length = [...value].length;
    if (length < min || length > max) {
      this.error(key, min > 0 ? `Use ${min} to ${max} characters.` : `Use at most ${max} characters.`);
    } else if (forbidden.test(value)) {
      this.error(key, `This field ${rule}.`);
    }
    return value;
  }
}

export function isSingleLine(value: string): boolean {
  return !SINGLE_LINE_FORBIDDEN.test(value);
}

/** A bare address: one @, a dotted domain, no whitespace, control characters or display-name punctuation. */
function isBareAddress(value: string): boolean {
  if ([...value].length > 254 || ADDRESS_FORBIDDEN.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local = "", domain = ""] = parts;
  return local.length > 0 && /^[^.]+(\.[^.]+)+$/u.test(domain);
}

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    invalid({ body: "Send a JSON object." });
  }
  return body as Record<string, unknown>;
}

/** The body as an object with at least one key (PATCH bodies). */
export function nonEmpty(body: unknown): Record<string, unknown> {
  const object = asObject(body);
  if (Object.keys(object).length === 0) invalid({ body: "Send at least one field to change." });
  return object;
}

export const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
