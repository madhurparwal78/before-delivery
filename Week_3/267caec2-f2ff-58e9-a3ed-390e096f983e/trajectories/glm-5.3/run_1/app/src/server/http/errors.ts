import type { ServerResponse } from "node:http";

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields?: FieldErrors, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "That email and password don't match."),
  forbidden: () => new ApiError(403, "forbidden", "Only the program director can do that."),
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "That request is too large."),
  fileTooLarge: () => new ApiError(413, "file_too_large", "Images must be 8,000,000 bytes or smaller."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "That request format isn't supported."),
  unsupportedType: () => new ApiError(415, "unsupported_type", "Upload a PNG or JPEG image."),
  notFound: () => new ApiError(404, "not_found", "We couldn't find that."),
  invalidTransition: (from: string, action: string) =>
    new ApiError(409, "invalid_transition", "That step isn't available in the current state.", undefined, { from, action }),
  idempotencyKeyReused: () => new ApiError(409, "idempotency_key_reused", "That idempotency key was already used for another entry."),
  deadlinePassed: (label: string) => new ApiError(409, "deadline_passed", `Entries closed at ${label}.`),
  deadlineNotPassed: (label: string) => new ApiError(409, "deadline_not_passed", `Entries are still open until ${label}.`),
  judgingStarted: () => new ApiError(409, "judging_started", "Judging has started, so dates and categories are locked."),
  categoryExists: () => new ApiError(409, "category_exists", "That category already exists in this program."),
  emailTaken: () => new ApiError(409, "email_taken", "An account already uses that email."),
  studioNameTaken: () => new ApiError(409, "studio_name_taken", "Another studio already uses that name."),
  screeningIncomplete: () => new ApiError(409, "screening_incomplete", "Screen every submitted entry before opening Round 1."),
  previousRoundNotConfirmed: () => new ApiError(409, "previous_round_not_confirmed", "Confirm Round 1 standings before opening the final round."),
  panelEmpty: () => new ApiError(409, "panel_empty", "Add at least one juror before opening."),
  noEntries: () => new ApiError(409, "no_entries", "There are no entries to judge in this round."),
  roundClosed: () => new ApiError(409, "round_closed", "This round closed before your ballot arrived. It was not counted."),
  ballotSubmitted: () => new ApiError(409, "ballot_submitted", "Your ballot is already submitted."),
  ballotIncomplete: (k: number) => new ApiError(409, "ballot_incomplete", `Score every entry before submitting. ${k} left.`),
  finalNotConfirmed: () => new ApiError(409, "final_not_confirmed", "Confirm the final round before publishing."),
  validation: (fields: FieldErrors) => new ApiError(422, "validation", "", fields),
  paymentsPaused: (message: string) => new ApiError(503, "payments_paused", message),
  mailUnavailable: (message: string) => new ApiError(503, "mail_unavailable", message),
  storageUnavailable: (message: string) => new ApiError(503, "storage_unavailable", message),
};

export function writeError(res: ServerResponse, error: ApiError): void {
  if (error.fields) {
    write(res, error.status, { errors: error.fields });
    return;
  }
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.extra) {
    Object.assign(body, error.extra);
  }
  write(res, error.status, body);
}

export function write(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
