import type { BodyStatus } from "../shared/types.js";

/**
 * Every error response is built here, in the one shape the API defines.
 */

export type ErrorCode =
  | "unauthenticated"
  | "bad_credentials"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "over_constrained"
  | "unsolvable"
  | "sketch_drives_feature"
  | "profile_not_ready"
  | "empty_body"
  | "separate_bodies"
  | "assembly_cycle"
  | "no_confirmed_body"
  | "stale_revision"
  | "invalid"
  | "storage_unavailable";

export const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  bad_credentials: "Email or password is not right.",
  forbidden: "Only the founder can change this.",
  not_found: "Not found.",
  idempotency_conflict: "This Idempotency-Key was already used for a different request.",
  over_constrained: "would conflict with",
  unsolvable: "No shape satisfies every constraint with this value. Nothing was changed.",
  sketch_drives_feature: "drives",
  profile_not_ready: "needs a closed, fully held profile before it can be extruded.",
  empty_body: "leaves no material. Nothing was changed.",
  separate_bodies: "would leave separate pieces; a part must be one connected body. Nothing was changed.",
  assembly_cycle: "cannot contain itself.",
  no_confirmed_body: "has no stored body yet, so it cannot be placed.",
  stale_revision: "saved",
  invalid: "Check the highlighted fields.",
  storage_unavailable: "Storage is unreachable."
};

export interface ErrorExtra {
  refused_label?: string;
  conflicts_with?: { id: string; label: string };
  current_revision?: number;
  saved_by?: { id: string; name: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly extra?: ErrorExtra;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fields?: Record<string, string>,
    extra?: ErrorExtra
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const inner: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.fields) inner.fields = err.fields;
  if (err.extra) Object.assign(inner, err.extra);
  return { error: inner };
}

export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  over_constrained: 409,
  unsolvable: 409,
  sketch_drives_feature: 409,
  profile_not_ready: 409,
  empty_body: 409,
  separate_bodies: 409,
  assembly_cycle: 409,
  no_confirmed_body: 409,
  stale_revision: 412,
  invalid: 422,
  storage_unavailable: 503
};

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(422, "invalid", MESSAGES.invalid, fields);
}

export function invalidFields(fields: Record<string, string>): ApiError {
  return invalid(fields);
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", MESSAGES.not_found);
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated", MESSAGES.unauthenticated);
}

export function staleRevision(member: { id: string; name: string }, thing: string, revision: number): ApiError {
  return new ApiError(412, "stale_revision", `${member.name} saved ${thing} at revision ${revision} after you opened it. Reload to see their changes.`, undefined, {
    current_revision: revision,
    saved_by: { id: member.id, name: member.name }
  });
}

export function overConstrained(refusedLabel: string, existing: { id: string; label: string }): ApiError {
  return new ApiError(409, "over_constrained", `${refusedLabel} would conflict with ${existing.label}. Nothing was changed.`, undefined, {
    refused_label: refusedLabel,
    conflicts_with: existing
  });
}

export function unsolvable(): ApiError {
  return new ApiError(409, "unsolvable", MESSAGES.unsolvable);
}

export function sketchDrivesFeature(sketchName: string, featureName: string): ApiError {
  return new ApiError(409, "sketch_drives_feature", `${sketchName} drives ${featureName} and must stay fully held. Nothing was changed.`);
}

export function profileNotReady(sketchName: string): ApiError {
  return new ApiError(409, "profile_not_ready", `${sketchName} needs a closed, fully held profile before it can be extruded.`);
}

export function emptyBody(operation: string): ApiError {
  return new ApiError(409, "empty_body", `${operation} leaves no material. Nothing was changed.`);
}

export function separateBodies(operation: string): ApiError {
  return new ApiError(409, "separate_bodies", `${operation} would leave separate pieces; a part must be one connected body. Nothing was changed.`);
}

export function assemblyCycle(assemblyName: string): ApiError {
  return new ApiError(409, "assembly_cycle", `${assemblyName} cannot contain itself.`);
}

export function noConfirmedBody(partName: string): ApiError {
  return new ApiError(409, "no_confirmed_body", `${partName} has no stored body yet, so it cannot be placed.`);
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", MESSAGES.storage_unavailable);
}

export function bodyStatusValue(status: string): BodyStatus {
  return status as BodyStatus;
}
