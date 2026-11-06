/**
 * One error shape for every route: `{"error":"<code>"}` plus the extra keys that
 * error names, and `{"error":"validation","errors":{…}}` for a 422.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: string,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export type FieldErrors = Record<string, string>;

export class ValidationError extends ApiError {
  readonly errors: FieldErrors;

  constructor(errors: FieldErrors) {
    super(422, 'validation');
    this.name = 'ValidationError';
    this.errors = errors;
  }

  override body(): Record<string, unknown> {
    return { error: 'validation', errors: this.errors };
  }
}

/** The import's 422 carries a row list rather than a field map. */
export class ImportInvalidError extends ApiError {
  constructor(errors: readonly { line: number; column: string; code: string }[]) {
    super(422, 'import_invalid');
    this.name = 'ImportInvalidError';
    this.rowErrors = errors;
  }

  readonly rowErrors: readonly { line: number; column: string; code: string }[];

  override body(): Record<string, unknown> {
    return { error: 'import_invalid', errors: this.rowErrors };
  }
}

export const fieldMessages = {
  email: 'Enter a valid email address.',
  required: 'This is required.',
  pastDate: 'Pick today or a later date.',
  amount: 'Enter an amount in dollars, like 45.00.',
  coordinates: 'Keep both points inside the photo and apart from each other.',
  nonexistentTime: (zone: string) => `That time does not exist on that date in ${zone}.`,
  cardNumber: 'Enter a test card token, never a card number.',
  unknownCard: 'Choose one of the test cards.',
  unknownRestoreVersion: "That version is not in this hoof's history.",
  chunkLength: (chunkBytes: number) => `Send exactly ${chunkBytes} bytes, or the rest of the file.`,
  range: (min: number, max: number) => `Enter a number from ${min} to ${max}.`,
} as const;

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const insufficientScope = (): ApiError => new ApiError(403, 'insufficient_scope');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, code, extra);
export const gone = (code: string): ApiError => new ApiError(410, code);
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large');

/** Illegal transitions on any day, booking, visit, payment or job action. */
export const illegalTransition = (from: string, action: string): ApiError =>
  new ApiError(409, 'illegal_transition', { from, action });

export const cardDeclined = (declineCode: string): ApiError =>
  new ApiError(402, 'card_declined', { decline_code: declineCode });

export const staleMarks = (current: unknown): ApiError =>
  new ApiError(412, 'stale_marks', { current });
