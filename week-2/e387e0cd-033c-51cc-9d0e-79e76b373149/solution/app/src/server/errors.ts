// The one published error shape. Every refusal in the API is an ApiError, written by http.ts.

type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldErrors = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const refuse = {
  notFound: () => new ApiError(404, "not_found", "Not found."),
  methodNotAllowed: (allow: string[]) =>
    new ApiError(405, "method_not_allowed", "Method not allowed.", {}, { Allow: allow.join(", ") }),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "rate_limited", `Too many requests. Try again in ${retryAfterSeconds} seconds.`, {},
      { "Retry-After": String(retryAfterSeconds) }),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  sessionEnded: () =>
    new ApiError(401, "session_ended", "Your session ended. Sign in again to continue. What you typed is kept."),
  accessRemoved: () => new ApiError(401, "access_removed", "Your access to this workspace was removed."),
  badPartnerKey: () => new ApiError(401, "bad_partner_key", "This partner key is not valid."),
  badSignature: () => new ApiError(401, "bad_signature", "The message signature could not be verified."),
  forbidden: () => new ApiError(403, "forbidden", "Your role can't do this."),
  tooLarge: () => new ApiError(413, "too_large", "The request is too large."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "This content type isn't accepted here."),
  badJson: () => new ApiError(400, "bad_json", "The request body isn't valid JSON."),
  badForm: () => new ApiError(400, "bad_form", "The form could not be read."),
  fileTooLarge: () => new ApiError(413, "file_too_large", "The certificate is larger than 5,000,000 bytes."),
  unsupportedFile: () => new ApiError(415, "unsupported_file", "Attach a PNG, JPEG or WebP image."),
  invalid: (fields: FieldErrors) => new ApiError(422, "invalid", "Check the highlighted fields.", fields),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  gone: (code: string, message: string) => new ApiError(410, code, message),
  storageUnreachable: () =>
    new ApiError(503, "storage_unreachable", "Storage is unreachable. Nothing was saved. Try again in a few minutes."),
  invoicingUnreachable: () =>
    new ApiError(503, "invoicing_unreachable",
      "Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes."),
};

/** Collects field errors so a 422 lists every failing field at once. */
export class FieldCheck {
  readonly errors: FieldErrors = {};

  fail(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  throwIfAny(): void {
    if (!this.ok) throw refuse.invalid(this.errors);
  }
}
