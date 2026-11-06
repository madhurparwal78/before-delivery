// Every API error uses one shape: {"error":{"code","message"}} plus optional fields.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra ?? {};
    this.fields = fields;
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message, ...this.extra };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export const errors = {
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "That request is too large for Saltprint Desk."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Saltprint Desk expects JSON for that request."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to use Saltprint Desk."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "That email and password don't match an account."),
  notFound: () => new ApiError(404, "not_found", "That isn't available on Saltprint Desk."),
  takenDown: () => new ApiError(410, "taken_down", "That essay has been taken down."),
  forbidden: () => new ApiError(403, "forbidden", "Your role can't do that on Saltprint Desk."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Saltprint Desk serves its own origin only."),
  databaseUnavailable: () => new ApiError(503, "database_unavailable", "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly."),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "Image storage is unreachable. Try again shortly."),
  billingRejected: () => new ApiError(502, "billing_rejected", "The billing provider refused that charge. Nothing was charged."),
  fileTooLarge: () => new ApiError(413, "file_too_large", "That file is larger than the 25 MB upload limit."),
  unsupportedType: () => new ApiError(415, "unsupported_type", "Only JPEG and PNG originals are accepted."),
  illegalTransition: (from: string, action: string) =>
    new ApiError(409, "illegal_transition", `That essay can't move from ${from} by that action.`, { from, action }),
  windowHeld: (heldBy: "you" | "your_newsroom" | "another_newsroom", heldUntil: string, heldUntilDisplay: string) =>
    new ApiError(409, "window_held", "Another newsroom already holds that exclusive window.", { held_by: heldBy, held_until: heldUntil, held_until_display: heldUntilDisplay }),
  exclusiveHeld: (heldBy: "you" | "your_newsroom" | "another_newsroom", heldUntil: string, heldUntilDisplay: string) =>
    new ApiError(409, "exclusive_held", "Another newsroom holds the exclusive on that essay.", { held_by: heldBy, held_until: heldUntil, held_until_display: heldUntilDisplay }),
  standardLicencesActive: (blockedUntil: string, blockedUntilDisplay: string) =>
    new ApiError(409, "standard_licences_active", "Standard licences are running on that essay.", { blocked_until: blockedUntil, blocked_until_display: blockedUntilDisplay }),
  alreadyLicensed: () => new ApiError(409, "already_licensed", "Your newsroom already licenses this essay."),
  notLicensable: () => new ApiError(409, "not_licensable", "This essay can't be licensed right now."),
  idempotencyKeyReused: () => new ApiError(409, "idempotency_key_reused", "That idempotency key was already used for a different request."),
  preconditionRequired: () => new ApiError(428, "precondition_required", "Send the essay's current version to save it."),
  versionConflict: (currentVersion: number) =>
    new ApiError(412, "version_conflict", "This essay was changed elsewhere. Reload it before saving; your edits are still in the form.", { current_version: currentVersion }),
  licencePending: () => new ApiError(409, "licence_pending", "The invoice is still pending; originals unlock when it is raised."),
  licenceEnded: () => new ApiError(410, "licence_ended", "This licence ended. Originals are no longer available."),
  licenceRevoked: () => new ApiError(410, "licence_revoked", "Licence revoked after a legal takedown. Originals are no longer available."),
  noWithdrawalRequest: () => new ApiError(409, "no_withdrawal_request", "No credited contributor has requested withdrawing that essay."),
  rateDateTaken: () => new ApiError(409, "rate_date_taken", "A commission rate is already scheduled from that date."),
  invoicesPending: () => new ApiError(409, "invoices_pending", "Some licences confirmed in that month are still pending invoice. Run the statement after they settle."),
  validationFailed: (fields: Record<string, string>) =>
    new ApiError(422, "validation_failed", "That request has fields Saltprint Desk can't accept.", undefined, fields),
};
