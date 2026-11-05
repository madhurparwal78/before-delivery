export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldErrors,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
  }

  body(): string {
    const err: { code: string; message: string; fields?: FieldErrors } = {
      code: this.code,
      message: this.message,
    };
    if (this.fields && Object.keys(this.fields).length > 0) err.fields = this.fields;
    return JSON.stringify({ error: err });
  }
}

export const errors = {
  tooLarge: () => new ApiError(413, "too_large", "That request body is too large."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "That content type isn't accepted here."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in first."),
  invalidCode: () => new ApiError(401, "invalid_code", "That code doesn't match anyone in this club."),
  forbidden: () => new ApiError(403, "forbidden", "You may not do that."),
  notFound: () => new ApiError(404, "not_found", "Nothing is at that address."),
  preconditionRequired: () => new ApiError(428, "precondition_required", "Send the cycle's current revision."),
  staleCycle: (etag: string) =>
    new ApiError(412, "stale_cycle", "Someone else changed this cycle. The latest times are shown.", undefined, {
      ETag: etag,
    }),
  validation: (fields: FieldErrors) => {
    const first = Object.values(fields)[0] ?? "Check the highlighted fields.";
    return new ApiError(422, "validation", first, fields);
  },
  wrongCycleState: () => new ApiError(409, "wrong_cycle_state", "This cycle isn't in a state where that can happen."),
  illegalTransition: () => new ApiError(409, "illegal_transition", "That cycle change isn't allowed."),
  closeInProgress: () => new ApiError(409, "close_in_progress", "This cycle is already closing."),
  unresolvedLines: () => new ApiError(409, "unresolved_lines", "Drop or take up every unfilled case first."),
  nothingToOrder: () => new ApiError(409, "nothing_to_order", "Every case was dropped, so there's nothing to order."),
  invoiceMissing: () => new ApiError(409, "invoice_missing", "Upload the distributor invoice before closing."),
  chargeMismatch: () => new ApiError(409, "charge_mismatch", "A charge in billing doesn't match."),
  cutoffPassed: () => new ApiError(409, "cutoff_passed", "Cutoff has passed."),
  notEnoughUnits: (left: number) =>
    new ApiError(409, "not_enough_units", `Only ${left} left.`, { units_to_go: String(left) }),
  insufficientCredit: () => new ApiError(409, "insufficient_credit", "Not enough credit."),
  lineNotSealed: () => new ApiError(409, "line_not_sealed", "That case isn't sealed."),
  lineAlreadyFull: () => new ApiError(409, "line_already_full", "That case is already full."),
  lineAlreadyResolved: (resolution: "dropped" | "taken_up") =>
    new ApiError(409, "line_already_resolved", `That case was already ${resolution}.`),
  uploadInProgress: () => new ApiError(409, "upload_in_progress", "Another upload of this file is still running."),
  outsidePickupWindow: () => new ApiError(409, "outside_pickup_window", "Outside the pickup window."),
  idempotencyKeyReused: () =>
    new ApiError(409, "idempotency_key_reused", "This request was already sent with a different body."),
  idempotencyKeyMissing: () =>
    new ApiError(422, "validation", "Send an idempotency key with this request.", { idempotency_key: "Send an idempotency key with this request." }),
  paymentsPaused: () => new ApiError(503, "payments_paused", "Payments are paused right now."),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "File storage is unavailable."),
  databaseBusy: () => new ApiError(503, "database_busy", "The club ledger is busy; try again."),
};
