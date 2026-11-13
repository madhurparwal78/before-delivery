export type ErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  body(): { error: string; message: string; details?: ErrorDetails } {
    return this.details === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, details: this.details };
  }
}

export const errors = {
  badRequest: (): ApiError => new ApiError(400, 'bad_request', "The request body isn't valid JSON."),
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  badCredentials: (): ApiError => new ApiError(401, 'bad_credentials', 'Username or password is wrong.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', "You don't have permission to do that."),
  methodNotAllowed: (): ApiError =>
    new ApiError(405, 'method_not_allowed', "This method isn't allowed here."),
  validation: (field: string, text: string): ApiError =>
    new ApiError(422, 'validation', text, { fields: { [field]: text } }),
  conflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  tooLarge: (max: number): ApiError =>
    new ApiError(413, 'payload_too_large', `Request body is too large (${max} bytes at most).`),
  rateLimited: (seconds: number): ApiError =>
    new ApiError(429, 'rate_limited', `Too many requests. Try again in ${seconds} seconds.`),
  storageUnavailable: (message: string): ApiError =>
    new ApiError(503, 'storage_unavailable', message),
};

export const storageOutageText =
  'File storage is unavailable. Uploads, artifacts and exports are paused.';
