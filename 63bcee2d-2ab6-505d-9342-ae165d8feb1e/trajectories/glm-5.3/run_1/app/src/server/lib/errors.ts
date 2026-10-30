// One error shape and one precedence for every endpoint.
// ApiError carries the status and the exact JSON body; the handler layer
// serialises it uniformly. Precedence is enforced by the order checks run
// in `guard` helpers and by the express error middleware ordering.

export interface ErrorBody {
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(typeof body.error === 'string' ? body.error : 'error');
    this.status = status;
    this.body = body;
  }
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'not_found' });
}

export function forbidden(): ApiError {
  return new ApiError(403, { error: 'forbidden' });
}

export function accessRemoved(): ApiError {
  return new ApiError(403, { error: 'access_removed' });
}

export function illegalTransition(from: string, action: string): ApiError {
  return new ApiError(409, { error: 'illegal_transition', from, action });
}

export function staleVersion(savedBy: string, savedAt: string): ApiError {
  return new ApiError(412, { error: 'stale_version', savedBy, savedAt });
}

export function validationError(errors: Record<string, string>): ApiError {
  return new ApiError(422, { error: 'validation', errors });
}

export function badRequest(): ApiError {
  return new ApiError(400, { error: 'bad_request' });
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, { error: 'billing_unavailable' });
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, { error: 'storage_unavailable' });
}

export function conflict(code: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, { error: code, ...extra });
}

// Field error copy — the exact published texts.

export const FIELD_ERRORS = {
  required: (label: string) => `${label} is required.`,
  tooLong: (label: string, limit: number) => `${label} can be at most ${limit} characters.`,
  oneLine: (label: string) => `${label} must be on one line.`,
  badEmail: (label: string) => `Enter an email address like name@example.com.`,
  range: (label: string, bounds: string) => `${label} must be between ${bounds}.`,
  amountFormat: (label: string) => `Enter an amount like 1250.00.`,
  futureDate: (label: string) => `${label} can't be in the future.`,
  closeAfterNow: 'Choose a close time after now.',
  expiryAfterNow: 'Choose an expiry after now.',
  currencyMismatch: 'Hong Kong and Macao projects bill in HKD; Singapore projects bill in SGD.',
  exclusionZero: 'Price this exclusion above zero.',
  provisionalOverBase: "Provisional sums can't add up to more than the base amount.",
  awardReasonMissing: 'Give a reason for not awarding the lowest levelled bid.',
  grossLower: "Gross valuation can't be lower than the last certificate's.",
  periodNotAfter: (date: string) => `Period ending must be after ${date}.`,
  commentsMissing: (codeLabel: string) => `Comments are needed for ${codeLabel}.`,
  supersededInSet: 'Only current revisions can be issued.',
  contractorReceivedAt: 'Only the studio can log a received time.',
  receivedAtRange: 'Received at must be between 1 Jan 2026 and now.',
  snagAfterDefects: (date: string) => `This defect was observed after the defects period ended on ${date}.`,
  fileTooLarge: (fileName: string, limitBytes: number) =>
    `${fileName} is larger than ${limitBytes.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} bytes.`,
  unsupportedFile: (fileName: string) => `${fileName} isn't a PDF, PNG, JPEG or SVG file.`,
  unsupportedImage: (fileName: string) => `${fileName} isn't a PNG or JPEG image.`,
  svgScript: (fileName: string) => `${fileName} contains scripts, so it wasn't accepted.`,
  storeUnknown: "Choose one of this project's stores.",
  retryKeyMissing: 'Retry key is missing; reload and try again.',
  csvMissingColumns: 'The file needs Finish Name and Category columns.',
  csvTooManyRows: 'The file can have at most 2,000 rows.',
} as const;
