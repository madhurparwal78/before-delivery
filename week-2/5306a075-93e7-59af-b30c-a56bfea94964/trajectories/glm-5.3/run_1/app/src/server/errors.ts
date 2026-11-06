/**
 * The one API error contract (DP-37). No handler writes its own error body.
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    [key: string]: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      fields?: Record<string, string> | undefined;
      extra?: Record<string, unknown> | undefined;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.extra = options.extra ?? {};
  }

  body(): ErrorBody {
    const err: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.status === 422 && this.fields !== undefined) {
      err.fields = this.fields;
    }
    for (const [k, v] of Object.entries(this.extra)) {
      err[k] = v;
    }
    return { error: err as ErrorBody["error"] };
  }
}

export const errors = {
  methodNotAllowed: (): ApiError => new ApiError(405, "method_not_allowed", "Method not allowed."),
  payloadTooLarge: (): ApiError => new ApiError(413, "payload_too_large", "The request body is too large."),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, "unsupported_media_type", "The request must be JSON."),
  unauthenticated: (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: (): ApiError =>
    new ApiError(401, "invalid_credentials", "Email or password is incorrect."),
  crossOrigin: (): ApiError => new ApiError(403, "cross_origin", "Cross-origin requests are not allowed."),
  forbidden: (): ApiError => new ApiError(403, "forbidden", "You may not do that."),
  notFound: (): ApiError => new ApiError(404, "not_found", "Not found."),
  linkInactive: (): ApiError =>
    new ApiError(404, "link_inactive", "This roadmap link is no longer active."),
  invalidTransition: (extra?: Record<string, unknown>): ApiError =>
    new ApiError(409, "invalid_transition", "That change is not allowed.", { extra }),
  releaseShipped: (): ApiError => new ApiError(409, "release_shipped", "This release has shipped."),
  releaseFrozen: (): ApiError => new ApiError(409, "release_frozen", "This release is frozen."),
  orderConflict: (current: unknown): ApiError =>
    new ApiError(409, "order_conflict", "The board changed while you were moving it.", {
      extra: { current },
    }),
  featureNotPlanned: (): ApiError =>
    new ApiError(409, "feature_not_planned", "The feature must be planned first."),
  versionConflict: (current: unknown): ApiError =>
    new ApiError(409, "version_conflict", "Someone else saved these scores first.", {
      extra: { current },
    }),
  duplicateInsight: (): ApiError =>
    new ApiError(409, "duplicate_insight", "This quote is already linked to that feature."),
  highlightConflict: (insightIds: string[]): ApiError =>
    new ApiError(409, "highlight_conflict", "This edit removes highlighted text.", {
      extra: { insightIds },
    }),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(422, "idempotency_key_reused", "That idempotency key was used for another release."),
  linkRevoked: (): ApiError => new ApiError(409, "link_revoked", "This link was revoked."),
  alreadyMember: (): ApiError => new ApiError(409, "already_member", "That email already has an account."),
  attachmentPending: (): ApiError =>
    new ApiError(409, "attachment_pending", "This attachment is still uploading."),
  invitationGone: (code: "invitation_replaced" | "invitation_used" | "invitation_expired"): ApiError =>
    new ApiError(410, code, "This invitation is no longer available."),
  validationFailed: (fields: Record<string, string>): ApiError =>
    new ApiError(422, "validation_failed", "Some fields need attention.", { fields }),
  storageUnavailable: (): ApiError =>
    new ApiError(503, "storage_unavailable", "Storage is unavailable right now."),
  internal: (): ApiError =>
    new ApiError(500, "internal_error", "Something went wrong on our side."),
};

/** The 422 field copy for an id in a request body (never 404). */
export const NO_SUCH_RECORD = "No such record in this workspace.";
