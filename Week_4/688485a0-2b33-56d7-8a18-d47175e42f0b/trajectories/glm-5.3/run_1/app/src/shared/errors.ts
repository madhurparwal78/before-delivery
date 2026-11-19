/**
 * The single published API error shape (DP-87). Every error is produced through
 * fail() and serialized as {"error":"<code>", ...extras}.
 */
export type ErrorCode =
  | "unauthenticated" | "invalid_credentials" | "not_found" | "read_only"
  | "version_conflict" | "invitation_closed" | "already_member" | "already_invited" | "not_confirmed"
  | "duplicate_key" | "name_taken" | "email_taken"
  | "invalid_field" | "invalid_id" | "id_mismatch" | "invalid_projection" | "invalid_index"
  | "invalid_validator" | "cannot_drop_id_index" | "owner_role_fixed" | "invalid_code"
  | "invalid_field_name" | "document_too_large" | "document_too_deep" | "scan_limit"
  | "too_many_stages" | "too_many_lines" | "query_too_deep"
  | "validation_failed" | "invalid_query" | "unknown_operator" | "unknown_stage" | "invalid_stage"
  | "import_failed" | "storage_unavailable" | "unsupported_media_type" | "too_large"
  | "invalid_body";

export interface ApiError extends Record<string, unknown> {
  readonly error: ErrorCode;
}

export class RequestError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extras: Record<string, unknown>;
  constructor(code: ErrorCode, status: number, extras: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extras = extras;
  }
  get body(): ApiError {
    return { error: this.code, ...this.extras };
  }
}

export function fail(code: ErrorCode, status: number, extras: Record<string, unknown> = {}): never {
  throw new RequestError(code, status, extras);
}

export function errorBody(code: ErrorCode, extras: Record<string, unknown> = {}): ApiError {
  return { error: code, ...extras };
}

/** A document message (the shared set used in Save status and load reports). */
export type DocumentMessage = string;

export function docMessage(kind: DocumentMessageKind, arg?: unknown): DocumentMessage {
  switch (kind) {
    case "not_json": return "not valid JSON";
    case "not_object": return "not an object";
    case "invalid_id": return "invalid _id";
    case "invalid_field_name": return `invalid field name at ${arg as string}`;
    case "too_large": return `document is larger than ${arg as number} bytes`;
    case "too_deep": return `document is nested deeper than ${ arg as number} levels`;
    case "row_cells": return `row has ${String((arg as number[])[0])} cells, header has ${String((arg as number[])[1])}`;
    case "missing_header": return "missing header row";
    case "duplicate_header": return `duplicate header ${arg as string}`;
    case "conflicting_header": return `conflicting header ${arg as string}`;
    default: return "";
  }
}

export type DocumentMessageKind =
  | "not_json" | "not_object" | "invalid_id" | "invalid_field_name" | "too_large" | "too_deep"
  | "row_cells" | "missing_header" | "duplicate_header" | "conflicting_header"
  | "validation" | "duplicate";

export function validationMessage(path: string, rule: "required" | "bsonType" | "minimum" | "maximum" | "enum", expected?: string): DocumentMessage {
  switch (rule) {
    case "required": return `Document failed validation at ${path}: required field is missing`;
    case "bsonType": return `Document failed validation at ${path}: expected ${expected ?? "string"}`;
    case "minimum": return `Document failed validation at ${path}: must be at least ${expected}`;
    case "maximum": return `Document failed validation at ${path}: must be at most ${expected}`;
    default: return `Document failed validation at ${path}: must be one of ${expected}`;
  }
}

export function duplicateMessage(valueText: string, indexName: string): DocumentMessage {
  return `Duplicate value ${valueText} for unique index ${indexName}`;
}
