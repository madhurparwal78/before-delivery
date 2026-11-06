// The one error shape. Nothing else in the server builds an error body.
export type FieldReason =
  | "required" | "invalid" | "too_long" | "out_of_range" | "too_far" | "unknown_field"
  | "not_png" | "trailing_data" | "animated" | "bad_dimensions" | "bad_image_data"
  | "unknown_resident" | "fixed_after_create" | "in_past" | "nonexistent_time";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly fields?: Record<string, FieldReason>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, FieldReason>, headers?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
    this.headers = headers;
  }

  body(): string {
    const err: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) (err as { fields?: unknown }).fields = this.fields;
    return JSON.stringify({ error: err });
  }
}

const fixed = (status: number, code: string, message: string) => new ApiError(status, code, message);

export const Errors = {
  unauthenticated: () => fixed(401, "unauthenticated", "You need a session for that."),
  notFound: () => fixed(404, "not_found", "Nothing was found here."),
  methodNotAllowed: () => fixed(405, "method_not_allowed", "That method isn't allowed here."),
  crossOrigin: () => fixed(403, "cross_origin", "That request came from another place."),
  tooLarge: () => fixed(413, "too_large", "That request was too big to carry."),
  unsupportedMediaType: () => fixed(415, "unsupported_media_type", "That content type isn't supported."),
  staleRevision: (currentRevision: number) =>
    new ApiError(412, "stale_revision", "This mission changed in another tab.", undefined, { ETag: `"${currentRevision}"` }),
  preconditionRequired: () => fixed(428, "precondition_required", "Name the revision you are editing."),
  internal: () => fixed(500, "internal", "Something went wrong on Bramble."),
  validation: (fields: Record<string, FieldReason>, message = "That request didn't check out.") =>
    new ApiError(422, "validation", message, fields),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  forbidden: (code: string, message: string) => new ApiError(403, code, message),
  gone: (code: string, message: string) => new ApiError(410, code, message),
  mailLimit: (retryAfterSeconds: number) =>
    new ApiError(429, "mail_limit", "That's a lot of postcards for one window.", undefined, { "Retry-After": String(retryAfterSeconds) }),
  darkroomClosed: () => new ApiError(503, "darkroom_closed", "The darkroom is closed."),
  postOfficeClosed: () => new ApiError(503, "post_office_closed", "The post office is closed."),
  waitingForDatabase: () => ({ status: 503, body: JSON.stringify({ status: "waiting_for_database" }) }),
};
