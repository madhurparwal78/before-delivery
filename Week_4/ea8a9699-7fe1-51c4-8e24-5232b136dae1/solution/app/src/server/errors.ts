// The one error shape (brief: API > Error shape). Every refusal in the server is built here.

const MESSAGES = {
  unauthenticated: [401, "Sign in to continue."],
  invalid_credentials: [401, "Email or password is incorrect."],
  cross_origin: [403, "Cross-origin requests are not accepted."],
  forbidden: [403, "You do not have permission for this action."],
  seat_required: [403, "You need a pro seat to make changes."],
  read_only_link: [403, "This review link is view-only."],
  not_found: [404, "Not found."],
  illegal_transition: [409, "That status change is not allowed."],
  cluster_locked: [409, "This cluster is locked."],
  cluster_not_in_review: [409, "Review links need a cluster in review."],
  already_in_cluster: [409, "That reference is already in this cluster."],
  no_seats_left: [409, "No seats left on this plan."],
  idempotency_conflict: [409, "This key was used for a different request."],
  idempotency_in_progress: [409, "A request with this key is still running."],
  link_expired: [410, "This review link has expired."],
  link_revoked: [410, "This review link was revoked."],
  link_inactive: [410, "This cluster is no longer in review."],
  invite_used: [410, "This invite has already been used."],
  stale_order: [412, "The order changed."],
  too_large: [413, "The request is larger than allowed."],
  unsupported_media_type: [415, "This content type is not accepted."],
  validation: [422, "Check the highlighted fields."],
  rate_limited: [429, "Too many comments. Try again shortly."],
  storage_unavailable: [503, "Storage is unreachable."],
  mail_unavailable: [503, "Mail is unreachable."],
  billing_unavailable: [503, "Billing is unreachable."],
  internal: [500, "Something went wrong."],
} as const satisfies Record<string, readonly [number, string]>;

type ErrorCode = keyof typeof MESSAGES;
export type FieldErrors = Record<string, string>;
type Extra = Record<string, string | number | string[] | FieldErrors>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: { error: ErrorCode; message: string } & Extra;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, extra: Extra = {}, headers: Record<string, string> = {}) {
    const [status, message] = MESSAGES[code];
    super(message);
    this.status = status;
    this.body = { error: code, message, ...extra };
    this.headers = headers;
  }
}

export const refuse = (code: ErrorCode, extra?: Extra, headers?: Record<string, string>): ApiError =>
  new ApiError(code, extra, headers);

/** 422 with the field messages from the brief's Field messages table. */
export const invalid = (errors: FieldErrors): ApiError => new ApiError("validation", { errors });

/** Thrown by the service clients; mapped to the matching 503 at the HTTP edge. */
export class Unavailable extends Error {
  readonly code: "storage_unavailable" | "mail_unavailable" | "billing_unavailable";
  constructor(code: Unavailable["code"], cause?: unknown) {
    super(code, { cause });
    this.code = code;
  }
}
