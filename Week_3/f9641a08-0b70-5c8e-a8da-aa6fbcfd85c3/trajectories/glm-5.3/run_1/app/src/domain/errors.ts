import { CONFIG } from '../config.js';

export class ApiError extends Error {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string> | null;

  constructor(status: number, code: string, message: string, fields: Record<string, string> | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', "That email and password don't match."),
  notFound: () => new ApiError(404, 'not_found', "We couldn't find that."),
  forbidden: () => new ApiError(403, 'forbidden', "You don't have permission to do that."),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Requests must come from the Roam House site.'),
  methodNotAllowed: (msg = "That action isn't allowed here.") => new ApiError(405, 'method_not_allowed', msg),
  idempotencyMismatch: () => new ApiError(409, 'idempotency_mismatch', 'This request was already used with different details. Start again.'),
  staleVersion: () => new ApiError(412, 'stale_version', 'This record changed since you opened it. Reload to see the latest version.'),
  outOfStockGone: (variant: string) => new ApiError(409, 'out_of_stock', `Sorry, the last ${variant} was just taken.`),
  outOfStockSome: (n: number) => new ApiError(409, 'out_of_stock', `Only ${n} left — we updated your bag.`),
  reservationExpired: () => new ApiError(409, 'reservation_expired', 'Your hold has ended and the items went back on sale. Press Pay to hold them again.'),
  invalidTransition: () => new ApiError(409, 'invalid_transition', "That change isn't possible from the current status."),
  duplicateRequest: () => new ApiError(409, 'duplicate_request', "There's already an open request for this item."),
  alreadyRedeemed: (balance: number) => new ApiError(409, 'already_redeemed', `This gift card has already been used. Its balance is now ₹${rupeeText(balance)}.`),
  emailTaken: () => new ApiError(409, 'email_taken', 'An account with this email already exists.'),
  tooLargeUpload: (limit: number) => new ApiError(413, 'too_large', `This file is larger than ${digitGroup(limit)} bytes.`),
  tooLargeBody: () => new ApiError(413, 'too_large', 'This request is too large.'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Send the request as JSON.'),
  validationFailed: (fields: Record<string, string>) => new ApiError(422, 'validation_failed', 'Check the highlighted fields.', fields),
  notEligible: () => new ApiError(422, 'not_eligible', "This item isn't eligible for that request."),
  codeInvalid: () => new ApiError(422, 'code_invalid', "We don't recognise that code."),
  codeExpired: (date: string) => new ApiError(422, 'code_expired', `This code expired on ${date}.`),
  codeExhausted: () => new ApiError(422, 'code_exhausted', 'This code has been fully used.'),
  codeNotApplicable: () => new ApiError(422, 'code_not_applicable', "This code doesn't apply to anything in your bag."),
  minimumNotMet: (shortfall: number) => new ApiError(422, 'minimum_not_met', `Add ₹${rupeeText(shortfall)} more to use this code.`),
  windowClosedReturns: (n: number, date: string) => new ApiError(422, 'window_closed', `The ${n}-day return window ended on ${date}.`),
  windowClosedTrials: (n: number, date: string) => new ApiError(422, 'window_closed', `The ${n}-day trial ended on ${date}.`),
  warrantyExpired: (date: string) => new ApiError(422, 'warranty_expired', `This item's warranty ended on ${date}.`),
  unsupportedFileImages: () => new ApiError(422, 'unsupported_file', 'Use a JPEG, PNG or WebP image.'),
  unsupportedFileEvidence: () => new ApiError(422, 'unsupported_file', 'Use a JPEG, PNG or WebP photo, or a PDF receipt.'),
  cardDeclined: () => new ApiError(402, 'card_declined', 'Your card was declined. No money was taken. Try another card.'),
  insufficientFunds: () => new ApiError(402, 'insufficient_funds', "Your card doesn't have enough funds. No money was taken. Try another card."),
  storageUnavailableImages: () => new ApiError(503, 'storage_unavailable', 'Image storage is unavailable. Nothing was published. Try again.'),
  storageUnavailableEvidence: () => new ApiError(503, 'storage_unavailable', 'Evidence storage is unavailable. Nothing was saved. Try again.'),
  emailUnavailable: () => new ApiError(503, 'email_unavailable', "We couldn't send your confirmation, so the order wasn't placed. Your bag is still held. Try again."),
};

export function errorBody(error: ApiError): string {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.fields) body.fields = error.fields;
  return JSON.stringify(body);
}

export function rupeeText(n: number): string {
  return digitGroup(n);
}

export function digitGroup(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.trunc(n)).toString();
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return sign + parts.join(',') + ',' + last3;
}

const IST = 5 * 60 + 30;

/** Formats a date like `4 November 2026` in India Standard Time. */
export function dateText(date: Date): string {
  const shifted = new Date(date.getTime() + IST * 60_000);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}`;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Formats a date like `4 November 2026, 3:04 pm` in IST. */
export function dateTimeText(date: Date): string {
  const shifted = new Date(date.getTime() + IST * 60_000);
  let hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${dateText(date)}, ${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/** `4 November 2026, 3:04 pm` with seconds for emails. */
export function dateForConfig(seconds: number): string {
  return '';
}

export function holdTextFromConfig(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

export function yearsText(n: number): string {
  return n === 1 ? '1 year' : `${n} years`;
}

export function configPublic(): Record<string, number | string> {
  return {
    reservation_ttl_seconds: CONFIG.reservationTtlSeconds,
    return_window_days: CONFIG.returnWindowDays,
    trial_window_days: CONFIG.trialWindowDays,
    compare_max: CONFIG.compareMax,
    page_size: CONFIG.pageSize,
    cart_undo_seconds: CONFIG.cartUndoSeconds,
    toast_seconds: CONFIG.toastSeconds,
    low_stock_threshold: CONFIG.lowStockThreshold,
    free_shipping_minimum: CONFIG.freeShippingMinimum,
    tax_rate_percent: CONFIG.taxRatePercent,
    upload_max_bytes: CONFIG.uploadMaxBytes,
    warranty_years_luggage: CONFIG.warrantyYearsLuggage,
    warranty_years_bags: CONFIG.warrantyYearsBags,
    warranty_years_accessories: CONFIG.warrantyYearsAccessories,
  };
}
