import type { ErrorBody } from "../shared/api.js";

const MESSAGES = {
  cross_origin: "Requests must come from this app's own origin.",
  too_large: "That request is larger than the app accepts.",
  unsupported_media_type: "Send JSON, or multipart form data for a capture.",
  malformed_json: "The request body is not valid JSON.",
  not_found: "This reference isn't in your deck.",
  idempotency_key_required: "Send an Idempotency-Key header of 1 to 64 visible ASCII characters.",
  idempotency_in_flight: "This save is still in progress. Wait for it to finish.",
  idempotency_conflict: "That Idempotency-Key was already used with different content.",
  reference_trashed: "This reference is in the trash. Restore it first.",
  reference_version_conflict: "This reference changed in another window. Reloaded the latest facts.",
  already_trashed: "This reference is already in the trash.",
  not_trashed: "This reference is not in the trash.",
  restore_window_closed: "The restore window for this reference has closed. It has been purged from your library.",
  already_in_reel: "That reference is already in this reel.",
  reel_full: "A reel holds at most 60 stops.",
  reel_version_conflict: "This reel changed in another window. Reloaded the latest order.",
  reel_empty: "Add at least one reference before printing.",
  sheet_not_failed: "Only a failed contact sheet can be retried.",
  sheet_not_ready: "This contact sheet has no PDF yet.",
  validation: "Check the highlighted fields.",
  storage_unavailable: "The photograph could not be stored, so nothing was saved. Try again when storage returns.",
  internal_error: "Something went wrong. Try again.",
} as const;

const STATUS: Record<ErrorCode, number> = {
  cross_origin: 403,
  too_large: 413,
  unsupported_media_type: 415,
  malformed_json: 400,
  not_found: 404,
  idempotency_key_required: 400,
  idempotency_in_flight: 409,
  idempotency_conflict: 409,
  reference_trashed: 409,
  reference_version_conflict: 409,
  already_trashed: 409,
  not_trashed: 409,
  restore_window_closed: 410,
  already_in_reel: 409,
  reel_full: 409,
  reel_version_conflict: 409,
  reel_empty: 409,
  sheet_not_failed: 409,
  sheet_not_ready: 409,
  validation: 422,
  storage_unavailable: 503,
  internal_error: 500,
};

type ErrorCode = keyof typeof MESSAGES;

/** Every refusal the API gives is thrown as one of these and answered by `errorBody`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: { message?: string; fields?: Record<string, string> } = {}) {
    super(options.message ?? MESSAGES[code]);
    this.code = code;
    this.status = STATUS[code];
    this.fields = options.fields;
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError("validation", { fields });
}

export function errorBody(error: ApiError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
}
