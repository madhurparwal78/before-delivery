// One error constructor builds every error response. Nothing else writes an
// error body, and no caught error's text is ever copied into a response.

export interface FieldError {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly fields?: FieldError;

  constructor(status: number, code: string, message: string, fields?: FieldError) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
  }

  body(): { error: { code: string; message: string; fields?: FieldError } } {
    const err: { code: string; message: string; fields?: FieldError } = {
      code: this.code,
      message: this.message,
    };
    if (this.fields) err.fields = this.fields;
    return { error: err };
  }
}

export const errors = {
  validationFailed: (fields: FieldError) =>
    new ApiError(422, "validation_failed", "Some fields need attention.", fields),
  vaultUnavailable: () => new ApiError(503, "vault_unavailable", "Filing vault unavailable."),
  invalidJson: () => new ApiError(422, "invalid_json", "Request body is not valid JSON."),
  internal: () => new ApiError(500, "internal", "Something went wrong. Nothing was changed."),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Cross-site writes are not allowed."),
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "The request body is too large."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Unsupported content type."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "Email or password is incorrect."),
  forbidden: () => new ApiError(403, "forbidden", "You may not perform this action."),
  badSignature: () => new ApiError(401, "bad_signature", "The tick signature is invalid."),
  staleSignature: () => new ApiError(401, "stale_signature", "The tick signature is stale."),
  invalidTransition: () => new ApiError(409, "invalid_transition", "This action is not allowed in the current state."),
  versionConflict: () =>
    new ApiError(409, "version_conflict", "This restatement changed since you opened it."),
  notPreparer: () => new ApiError(403, "not_preparer", "Only the preparer may edit this restatement."),
  preparerCannotClear: () =>
    new ApiError(403, "preparer_cannot_clear", "The preparer may not review their own restatement."),
  preparerCannotRelease: () =>
    new ApiError(403, "preparer_cannot_release", "The preparer may not release this restatement."),
  clearerCannotRelease: () =>
    new ApiError(403, "clearer_cannot_release", "The person who cleared this restatement may not release it."),
  restatementOpen: () => new ApiError(409, "restatement_open", "Another restatement is already open."),
  weekOutOfSequence: () => new ApiError(409, "week_out_of_sequence", "That week is out of sequence."),
  weekNotEnded: () => new ApiError(409, "week_not_ended", "That week has not ended yet."),
  notLatestWeek: () => new ApiError(409, "not_latest_week", "Only the latest published week may be corrected."),
  exhibitNotVerified: () => new ApiError(409, "exhibit_not_verified", "Attach a verified exhibit first."),
  tickIdConflict: () => new ApiError(409, "tick_id_conflict", "That tick id is already used with different data."),
  sessionClosed: () => new ApiError(409, "session_closed", "The market session is closed for share-price ticks."),
  idempotencyConflict: () =>
    new ApiError(409, "idempotency_conflict", "That idempotency key is already used for another restatement."),
};
