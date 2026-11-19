// Closed-schema validation at the edge: every body and query is read once here against its published fields.
import { ApiError } from "./http.ts";
import { isIsoDate, parseWall, type IsoDate, type WallMinutes } from "../shared/time.ts";
import { isReportMonth } from "../shared/rules.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 3 to 254 characters, no whitespace, one `@` with something before it, and a dot inside the part after it. */
function isEmailAddress(value: string): boolean {
  if (value.length < 3 || value.length > 254 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split("@");
  const [local = "", domain = ""] = parts;
  if (parts.length !== 2 || local.length === 0) return false;
  const dot = domain.slice(1, -1).includes(".");
  return dot;
}

/** Collects field errors for one request; `raise()` is called where the API precedence puts validation. */
export class Fields {
  readonly errors: Record<string, string> = {};
  private readonly source: Record<string, unknown>;

  /** `allowed` lists every field the endpoint publishes for this caller; any other key is an unknown field. */
  constructor(body: unknown, allowed: readonly string[]) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      this.source = {};
      this.errors.body = "Send a JSON object of at most 20 levels.";
      return;
    }
    this.source = body as Record<string, unknown>;
    for (const key of Object.keys(this.source)) if (!allowed.includes(key)) this.errors[key] = "Unknown field.";
  }

  raw(name: string): unknown {
    return this.source[name];
  }

  fail(name: string, message: string): undefined {
    this.errors[name] ??= message;
    return undefined;
  }

  /** A string kept exactly as sent; its length is judged after trimming. */
  string(name: string, message: string, min = 1, max = 10_000): string | undefined {
    const value = this.source[name];
    if (typeof value !== "string" || value.includes("\0")) return this.fail(name, message);
    const length = value.trim().length;
    return length < min || length > max ? this.fail(name, message) : value;
  }

  /** The email rule for sign-in and inspector_email. */
  email(name: string, message: string): string | undefined {
    const value = this.source[name];
    return typeof value === "string" && isEmailAddress(value) ? value : this.fail(name, message);
  }

  date(name: string, message = "Use a date as YYYY-MM-DD."): IsoDate | undefined {
    const value = this.source[name];
    return typeof value === "string" && isIsoDate(value) ? value : this.fail(name, message);
  }

  /** A site-local wall time on a quarter-hour step, `00:00` to `24:00`. */
  wall(name: string): WallMinutes | undefined {
    const value = this.source[name];
    const minutes = typeof value === "string" ? parseWall(value) : null;
    return minutes !== null && minutes % 15 === 0 ? minutes : this.fail(name, "Use a quarter-hour time as HH:MM.");
  }

  integer(name: string, min: number, max: number, message: string): number | undefined {
    const value = this.source[name];
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : this.fail(name, message);
  }

  /** A required id field: absent is a validation error; anything else that is not an id answers 404 at lookup. */
  id(name: string): string | undefined {
    const value = this.source[name];
    if (value === undefined) return this.fail(name, "Required.");
    return typeof value === "string" ? value : "";
  }

  raise(): void {
    if (Object.keys(this.errors).length > 0) this.reject();
  }

  /** Refuses the request with the collected field errors; called when a required value is missing. */
  reject(): never {
    throw new ApiError("validation", { fields: this.errors });
  }
}

/** The `Idempotency-Key` header: 1 to 100 letters, digits, `-` and `_`. */
export function idempotencyKey(header: string | string[] | undefined, fields: Fields): string | undefined {
  if (typeof header === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(header)) return header;
  return fields.fail("Idempotency-Key", "Send an Idempotency-Key of 1 to 100 letters, digits, - or _.");
}

export function validMonth(value: string | null): string | null {
  return value !== null && isReportMonth(value) ? value : null;
}
