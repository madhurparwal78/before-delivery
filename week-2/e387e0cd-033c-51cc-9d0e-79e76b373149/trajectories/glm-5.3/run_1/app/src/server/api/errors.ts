// The one error shape and the one precedence ladder.
export interface FieldErrors { [field: string]: string }

export class ApiError extends Error {
  status: number;
  code: string;
  fields: FieldErrors;
  extraHeaders: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: FieldErrors = {}, extraHeaders: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extraHeaders = extraHeaders;
  }

  body(): string {
    return JSON.stringify({ error: { code: this.code, message: this.message, fields: this.fields } });
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  sessionEnded: () => new ApiError(401, 'session_ended', 'Your session ended. Sign in again to continue. What you typed is kept.'),
  accessRemoved: () => new ApiError(401, 'access_removed', 'Your access to this workspace was removed.'),
  badPartnerKey: () => new ApiError(401, 'bad_partner_key', 'This partner key is not valid.'),
  badSignature: () => new ApiError(401, 'bad_signature', 'The message signature could not be verified.'),
  signInFailed: () => new ApiError(401, 'sign_in_failed', 'Email or password is incorrect.'),
  forbidden: () => new ApiError(403, 'forbidden', "Your role can't do this."),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  methodNotAllowed: (allow: string) => new ApiError(405, 'method_not_allowed', 'Method not allowed.', {}, { Allow: allow }),
  listingWithdrawn: () => new ApiError(410, 'listing_withdrawn', 'This exchange has withdrawn its listing.'),
  requestPageEnded: () => new ApiError(410, 'request_page_ended', 'This data request page has ended. Ask the requesting exchange for a new one.'),
  originalErased: () => new ApiError(410, 'original_erased', 'This original was erased under the retention rule.'),
  tooLarge: () => new ApiError(413, 'too_large', 'The request is too large.'),
  fileTooLarge: () => new ApiError(413, 'file_too_large', 'The certificate is larger than 5,000,000 bytes.'),
  unsupportedMedia: () => new ApiError(415, 'unsupported_media_type', "This content type isn't accepted here."),
  unsupportedFile: () => new ApiError(415, 'unsupported_file', 'Attach a PNG, JPEG or WebP image.'),
  badJson: () => new ApiError(400, 'bad_json', "The request body isn't valid JSON."),
  badForm: () => new ApiError(400, 'bad_form', 'This form could not be read.'),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  invalid: (fields: FieldErrors) => new ApiError(422, 'invalid', 'Check the highlighted fields.', fields),
  rateLimited: (retryAfterSeconds: number) => new ApiError(429, 'rate_limited', `Too many requests. Try again in ${retryAfterSeconds} seconds.`, {}, { 'Retry-After': String(retryAfterSeconds) }),
  storageUnreachable: () => new ApiError(503, 'storage_unreachable', 'Storage is unreachable. Nothing was saved. Try again in a few minutes.'),
  invoicingUnreachable: () => new ApiError(503, 'invoicing_unreachable', 'Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes.'),
};
