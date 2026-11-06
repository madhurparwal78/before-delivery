// Request helpers shared by the route modules.

import { SESSION_COOKIE, sessionPerson, type Person, type Project } from "../auth.js";
import { pool, type Db } from "../db.js";
import { HALF_HOUR, isHalfHour, parseTimestamp } from "../domain/time.js";
import { HttpError, type Context, type JsonBody } from "../http.js";

export async function requirePerson(ctx: Context): Promise<Person> {
  const person = await sessionPerson(ctx.cookies[SESSION_COOKIE]);
  if (!person) throw new HttpError(401, { error: "unauthenticated" });
  return person;
}

interface RecordBounds {
  start: number;
  end: number;
}

/** First interval start and the end of the last half-hour of a project's readings; null with no readings. */
export async function recordBounds(db: Db | typeof pool, slug: string): Promise<RecordBounds | null> {
  const { rows } = await db.query<{ first: number | null; last: number | null }>(
    "SELECT epoch(min(interval_start)) AS first, epoch(max(interval_start)) AS last FROM readings WHERE project = $1", [slug]);
  const { first, last } = rows[0]!;
  return first === null || last === null ? null : { start: first, end: last + HALF_HOUR };
}

interface Scope {
  start: number;
  end: number;
  sensorIds: string[];
}

/** Validates `start`, `end` and `sensor_ids` of a preview or seal; errors are added to `errors`. */
export function validateScope(project: Project, bounds: RecordBounds | null, body: JsonBody,
  errors: Record<string, string>): Scope | null {
  const start = parseTimestamp(body.start);
  const end = parseTimestamp(body.end);
  if (start === null || !isHalfHour(start)) errors.start = "must be a UTC half-hour in the form YYYY-MM-DDTHH:MM:SSZ";
  else if (!bounds || start < bounds.start) errors.start = "must not be before the first reading";
  if (end === null || !isHalfHour(end)) errors.end = "must be a UTC half-hour in the form YYYY-MM-DDTHH:MM:SSZ";
  else if (!bounds || end > bounds.end) errors.end = "must not be after the end of the last reading";
  if (start !== null && end !== null && !errors.start && !errors.end && start >= end) errors.end = "must be after start";

  const ids = body.sensor_ids;
  const known = new Set(project.sensors.map((s) => s.id));
  const valid = Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && known.has(id)) &&
    new Set(ids).size === ids.length;
  if (!valid) errors.sensor_ids = "must be a non-empty list of distinct sensor ids of this project";

  return Object.keys(errors).length === 0 ? { start: start!, end: end!, sensorIds: ids as string[] } : null;
}
