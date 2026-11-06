// Field validation that collects every 422 message for a body (brief: Feedback states, field errors).
import { FIELD } from "../shared/copy";
import { isRealDate } from "../shared/zones";
import { invalid } from "./http";

export type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Body) : {};
}

export class Fields {
  readonly errors: Record<string, string> = {};

  fail(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Throws the collected 422, if any. */
  check(): void {
    if (!this.ok) throw invalid(this.errors);
  }

  /** Text of 1..max code points (blank refused as required). */
  text(field: string, value: unknown, max: number): string | null {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      this.fail(field, FIELD.required);
      return null;
    }
    if (typeof value !== "string") {
      this.fail(field, FIELD.required);
      return null;
    }
    if ([...value].length > max) {
      this.fail(field, FIELD.maxChars(max));
      return null;
    }
    return value.trim();
  }

  email(field: string, value: unknown): string | null {
    if (typeof value !== "string" || value.trim() === "") {
      this.fail(field, FIELD.required);
      return null;
    }
    const email = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || [...email].length > 254) {
      this.fail(field, FIELD.email);
      return null;
    }
    return email.toLowerCase();
  }

  option<T extends string>(field: string, value: unknown, options: readonly T[]): T | null {
    if (value === undefined || value === null || value === "") {
      this.fail(field, FIELD.required);
      return null;
    }
    if (typeof value !== "string" || !options.includes(value as T)) {
      this.fail(field, FIELD.option);
      return null;
    }
    return value as T;
  }

  date(field: string, value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      this.fail(field, FIELD.required);
      return null;
    }
    if (typeof value !== "string" || !isRealDate(value)) {
      this.fail(field, FIELD.date);
      return null;
    }
    return value;
  }

  whole(field: string, value: unknown, min: number, max: number): number | null {
    if (value === undefined || value === null || value === "") {
      this.fail(field, FIELD.required);
      return null;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      this.fail(field, FIELD.whole(min, max));
      return null;
    }
    return value;
  }

  /** Metres as a number with at most two decimals, within a range, as whole centimetres. */
  metres(field: string, value: unknown, minCm: number, maxCm: number): number | null {
    if (value === undefined || value === null || value === "") {
      this.fail(field, FIELD.required);
      return null;
    }
    const range = FIELD.number((minCm / 100).toFixed(2), (maxCm / 100).toFixed(2));
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(field, range);
      return null;
    }
    const text = String(value);
    if (/e/i.test(text) || (text.split(".")[1] ?? "").length > 2) {
      this.fail(field, FIELD.twoDecimals);
      return null;
    }
    const [whole, fraction = ""] = text.replace("-", "").split(".");
    const cm = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (value < 0 ? -1 : 1);
    if (cm < minCm || cm > maxCm) {
      this.fail(field, range);
      return null;
    }
    return cm;
  }
}
