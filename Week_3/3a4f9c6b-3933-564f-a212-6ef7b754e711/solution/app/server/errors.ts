// The single error shape of the API: {"error":"<code>","message":"<sentence>", ...extra}.

const STATUS = {
  payload_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  request_key_required: 400,
  request_key_reused: 409,
  validation: 422,
  invalid_transition: 409,
  stage_busy: 409,
  not_verified_upstream: 409,
  version_exists: 409,
  evidence_pending: 409,
  approval_expired: 409,
  no_healthy_revision: 409,
  phase_regression: 409,
  promotion_not_running: 409,
  link_expired: 410,
  stale_version: 412,
  storage_unavailable: 503,
} as const;

type ErrorCode = keyof typeof STATUS;

type ErrorExtra =
  | { fields: Record<string, string> }
  | { holder: { promotion_id: string; bundle_version: string; bundle_digest: string; state: string } }
  | { state: string }
  | { current_version: number }
  | Record<string, never>;

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: ErrorExtra = {},
    // The refusal follows a change that must persist (an expiry recorded while refusing a lapsed call).
    readonly commitFirst = false,
  ) {
    super(message);
    this.status = STATUS[code];
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError("validation", "Some fields need attention.", { fields });
}
