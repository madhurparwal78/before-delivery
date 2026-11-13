/** Every API error uses the one error shape: {"error","message"} plus named extras. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(String(body.error));
  }
}

export const STORAGE_DOWNLOAD_MESSAGE =
  'Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.';
export const STORAGE_SAVE_MESSAGE =
  'Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.';

export const unauthenticated = (): ApiError =>
  new ApiError(401, { error: 'unauthenticated', message: 'Sign in to continue.' });

export const notFound = (): ApiError => new ApiError(404, { error: 'not_found', message: 'Not found.' });

export const forbidden = (): ApiError =>
  new ApiError(403, { error: 'forbidden', message: "You can't do that on this part." });

export const invalid = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { error: 'invalid', message: 'Check the highlighted fields.', errors });

export const crossOrigin = (): ApiError =>
  new ApiError(403, { error: 'cross_origin', message: 'Requests must come from Tinework.' });

export const tooLargeBody = (limit: number): ApiError =>
  new ApiError(413, { error: 'too_large', message: `Request body is larger than ${limit} bytes.` });

export const valueGrammar = (field: string, label: string): ApiError =>
  new ApiError(422, {
    error: 'value_grammar',
    field,
    message: `${label} takes a plain decimal such as 12.5.`,
  });

export const storageUnavailable = (message: string): ApiError =>
  new ApiError(503, { error: 'storage_unavailable', message }, { 'Retry-After': '5' });

export const preconditionRequired = (): ApiError =>
  new ApiError(428, {
    error: 'precondition_required',
    message: "Send If-Match with the revision history's ETag.",
  });

export const badIdempotencyKey = (): ApiError =>
  new ApiError(400, {
    error: 'invalid_idempotency_key',
    message: 'Idempotency-Key must be 1 to 255 printable characters.',
  });

export const idempotencyInProgress = (): ApiError =>
  new ApiError(409, {
    error: 'idempotency_in_progress',
    message: 'A request with this Idempotency-Key is still being processed.',
  });

export const keyReused = (): ApiError =>
  new ApiError(422, {
    error: 'key_reused',
    message: 'This Idempotency-Key was already used for a different request.',
  });

export const mailUnavailableSignup = (): ApiError =>
  new ApiError(503, {
    error: 'mail_unavailable',
    message: 'We could not send the email right now. Try again in a minute.',
  });

export const mailUnavailableRoom = (): ApiError =>
  new ApiError(503, {
    error: 'mail_unavailable',
    message: 'We could not send the invitations right now. Try again in a minute.',
  });

export const roomClosed = (): ApiError =>
  new ApiError(409, { error: 'room_closed', message: 'This review room is closed.' });
