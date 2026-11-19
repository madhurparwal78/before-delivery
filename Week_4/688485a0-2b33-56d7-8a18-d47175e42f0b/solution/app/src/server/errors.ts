import type { JsonObject, JsonValue } from "../shared/json.js";

const STATUS = {
  unsupported_media_type: 415,
  too_large: 413,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  read_only: 403,
  version_conflict: 409,
  invitation_closed: 409,
  already_member: 409,
  already_invited: 409,
  not_confirmed: 409,
  duplicate_key: 409,
  name_taken: 409,
  email_taken: 409,
  invalid_field: 422,
  invalid_id: 422,
  id_mismatch: 422,
  invalid_projection: 422,
  invalid_index: 422,
  invalid_validator: 422,
  cannot_drop_id_index: 422,
  owner_role_fixed: 422,
  invalid_code: 422,
  invalid_field_name: 422,
  document_too_large: 422,
  document_too_deep: 422,
  scan_limit: 422,
  too_many_stages: 422,
  too_many_lines: 422,
  query_too_deep: 422,
  validation_failed: 422,
  invalid_query: 422,
  unknown_operator: 422,
  unknown_stage: 422,
  invalid_stage: 422,
  import_failed: 422,
  storage_unavailable: 503,
  starting: 503,
  internal_error: 500,
} as const;

type ErrorCode = keyof typeof STATUS;

/** Every API error is raised as an ApiError and answered through the one error shape. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly extras: Record<string, JsonValue> = {},
  ) {
    super(code);
    this.status = STATUS[code];
  }

  body(): JsonObject {
    return { error: this.code, ...this.extras };
  }
}

export function fail(code: ErrorCode, extras: Record<string, JsonValue> = {}): never {
  throw new ApiError(code, extras);
}
