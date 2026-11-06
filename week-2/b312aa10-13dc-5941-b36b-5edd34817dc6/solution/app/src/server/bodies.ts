// The accepted keys of every write body, per endpoint and station kind. Any other key answers
// "This field cannot be set."; a listed key that is missing answers "This field is required."
// unless it is optional (and then takes its default in the handler).

import { invalid } from "./http.js";

interface BodySpec { required: readonly string[]; optional?: readonly string[] }

export const BODIES = {
  session: { required: ["email", "password"] },
  empty: { required: [] },
  hourlyHold: { required: ["stationId", "date", "start", "end"], optional: ["repeatWeeks", "notes"] },
  shelfHold: { required: ["stationId", "date", "days"], optional: ["notes"] },
  hourlyMove: { required: ["stationId", "date", "start", "end", "version"] },
  shelfMove: { required: ["stationId", "date", "days", "version"] },
  hourlyRate: { required: ["offPeakHourlyCents", "peakHourlyCents", "effectiveFrom"] },
  shelfRate: { required: ["shelfDayCents", "effectiveFrom"] },
  peakWindows: { required: ["windows", "rulesVersion"] },
  documentRequirements: { required: ["required", "rulesVersion"] },
  outOfService: { required: ["stationId", "date", "start", "end", "reason"] },
  businessName: { required: ["businessName"] },
  sanitationEntry: { required: ["area", "task", "initials"], optional: ["sanitizerPpm", "notes"] },
  sanitationReport: { required: ["month"] },
  inspectorLink: { required: ["email", "expiresAt"] },
  document: { required: ["type", "expiryDate", "file"] },
  approveDocument: { required: ["version"] },
} as const satisfies Record<string, BodySpec>;

const CANNOT_SET = "This field cannot be set.";
export const REQUIRED = "This field is required.";

/** Key errors for a body: every unlisted key and every missing required key. */
export function keyErrors(keys: Iterable<string>, spec: BodySpec): Record<string, string> {
  const present = new Set(keys);
  const allowed = new Set([...spec.required, ...(spec.optional ?? [])]);
  const errors: Record<string, string> = {};
  for (const key of present) if (!allowed.has(key)) errors[key] = CANNOT_SET;
  for (const key of spec.required) if (!present.has(key)) errors[key] = REQUIRED;
  return errors;
}

/** Refuses any key in the body of an action whose request is `{}`. */
export function refuseAnyKey(body: unknown): void {
  const errors = keyErrors(Object.keys(bodyObject(body)), BODIES.empty);
  if (Object.keys(errors).length) throw invalid(errors);
}

/** A JSON body as a plain object (anything else carries no keys). */
export function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
