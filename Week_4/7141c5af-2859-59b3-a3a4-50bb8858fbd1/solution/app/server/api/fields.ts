import { copy } from "../domain/copy.ts";
import { isDecimal } from "../domain/decimal.ts";
import { isRealDate, isRealTime } from "../domain/time.ts";
import { ApiError, invalid } from "../http/errors.ts";
import { one } from "../db/pool.ts";
import { addSeconds } from "../domain/time.ts";
import type { Ctx } from "../http/router.ts";

export type Body = Record<string, unknown>;

/** A JSON body that is not an object has none of an endpoint's fields, so every required field reads as empty. */
export function bodyOf(ctx: Ctx): Body {
  const body = ctx.json;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Body) : {};
}

const isEmpty = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

function characters(text: string): number {
  return [...text].length;
}

/** A required text field: F-04 when empty, F-05 over its limit in code points. */
export function requiredText(body: Body, field: string, limit: number): string {
  const value = body[field];
  if (isEmpty(value)) throw invalid(field, copy("F-04"));
  if (typeof value !== "string") throw invalid(field, copy("F-04"));
  if (characters(value) > limit) throw invalid(field, copy("F-05", { n: limit.toLocaleString("en-US") }));
  return value;
}

/** An optional text field; empty reads as null. */
export function optionalText(body: Body, field: string, limit: number): string | null {
  const value = body[field];
  if (isEmpty(value)) return null;
  if (typeof value !== "string") throw invalid(field, copy("F-08"));
  if (characters(value) > limit) throw invalid(field, copy("F-05", { n: limit.toLocaleString("en-US") }));
  return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailField(body: Body): string {
  const value = requiredText(body, "email", 254).trim();
  if (!EMAIL.test(value)) throw invalid("email", copy("F-06"));
  return value;
}

/** A required `YYYY-MM-DD`: F-04 empty, F-07 in any other form. */
export function dateField(body: Body, field: string): string {
  const value = body[field];
  if (isEmpty(value)) throw invalid(field, copy("F-04"));
  if (typeof value !== "string" || !isRealDate(value)) throw invalid(field, copy("F-07"));
  return value;
}

/** A required 24-hour `HH:MM`: F-04 empty, F-111 in any other form. */
export function timeField(body: Body, field: string): string {
  const value = body[field];
  if (isEmpty(value)) throw invalid(field, copy("F-04"));
  if (typeof value !== "string" || !isRealTime(value)) throw invalid(field, copy("F-111"));
  return value;
}

/** A number or decimal-string field in the accepted form, as its exact decimal text: F-04 empty, F-112 otherwise. */
export function decimalField(body: Body, field: string): string {
  const value = body[field];
  if (isEmpty(value)) throw invalid(field, copy("F-04"));
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !isDecimal(text)) throw invalid(field, copy("F-112"));
  return text;
}

/** As `decimalField`, but empty is allowed and reads as null. */
export function optionalDecimal(body: Body, field: string): string | null {
  return isEmpty(body[field]) ? null : decimalField(body, field);
}

/**
 * Counts one request against a window that starts at the first request; a request past the limit gets the window's end.
 * The row is the only state, so a restart loses nothing.
 */
export async function countInWindow(scope: string, limit: number, windowSeconds: number): Promise<Date | null> {
  const row = await one<{ started_at: Date; count: number }>(
    `INSERT INTO rate_windows (scope, started_at, count) VALUES ($1, now(), 1)
     ON CONFLICT (scope) DO UPDATE SET
       count = CASE WHEN rate_windows.started_at + make_interval(secs => $2) <= now() THEN 1 ELSE rate_windows.count + 1 END,
       started_at = CASE WHEN rate_windows.started_at + make_interval(secs => $2) <= now() THEN now() ELSE rate_windows.started_at END
     RETURNING started_at, count`,
    [scope, windowSeconds],
  );
  if (!row || row.count <= limit) return null;
  return addSeconds(row.started_at, windowSeconds);
}

/** Runs every field check and answers one 422 holding all the refused fields. */
export function checkFields<Checks extends Record<string, () => unknown>>(checks: Checks): { [Name in keyof Checks]: ReturnType<Checks[Name]> } {
  const values: Record<string, unknown> = {};
  let refused: ApiError | null = null;
  let fields: Record<string, string> = {};
  for (const [name, check] of Object.entries(checks)) {
    try {
      values[name] = check();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
      refused ??= error;
      fields = { ...fields, ...error.fields };
    }
  }
  if (refused) throw new ApiError(422, refused.code, refused.message, fields);
  return values as { [Name in keyof Checks]: ReturnType<Checks[Name]> };
}
