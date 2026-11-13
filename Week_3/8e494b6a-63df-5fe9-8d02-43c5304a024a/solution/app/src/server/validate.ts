// Field-level validation that reports every problem at once in the one `invalid` shape.
import { errors } from "./errors";

const MAX_ROW_ID = 2147483647;

/** A row id from a path or body value, or null when it can't name a row (not whole, or outside the integer column). */
export function rowId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= MAX_ROW_ID ? id : null;
}

export class Check {
  private readonly fields: Record<string, string> = {};

  fail(field: string, sentence: string): void {
    this.fields[field] ??= sentence;
  }

  text(body: Record<string, unknown>, field: string, sentence: string, max = 200): string {
    const value = body[field];
    if (typeof value !== "string" || value.trim() === "" || Array.from(value).length > max) {
      this.fail(field, sentence);
      return "";
    }
    return value;
  }

  whole(body: Record<string, unknown>, field: string, sentence: string, min = 0): number {
    const value = body[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
      this.fail(field, sentence);
      return 0;
    }
    return value;
  }

  done(): void {
    if (Object.keys(this.fields).length > 0) throw errors.invalid(this.fields);
  }
}

export const STREAM_NAME = /^[a-z0-9-]{1,40}$/;
