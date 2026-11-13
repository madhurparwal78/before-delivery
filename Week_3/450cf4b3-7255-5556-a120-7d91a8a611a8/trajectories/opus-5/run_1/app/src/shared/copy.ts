import { formatDuration } from './format';

export const MINIMUM_BOOKING_MINUTES = 120;
export const BOOKING_HORIZON_DAYS = 60;
export const OPENS_AT = '05:00';
export const CLOSES_AT = '23:00';
export const CLEANUP_MINUTES = 30;
export const KITCHEN_NAME = 'Halfsheet Commissary';

export const spanHint = {
  length: `Pick a span of at least ${formatDuration(MINIMUM_BOOKING_MINUTES)}`,
  started: 'That span has already started. Pick a later span.',
  horizon: `Bookings open up to ${BOOKING_HORIZON_DAYS} days ahead. Pick an earlier date.`,
};

/** Booking shape sentences, in rule order. */
export const shapeSentence = {
  station: 'Pick a station on the floor plan.',
  shelf: 'Pick a walk-in shelf to pair with a range, prep table or mixer.',
  isoTime: 'Use an ISO 8601 time with a UTC offset.',
  halfHour: 'Use a time on the hour or half hour.',
  minimumLength: `Bookings last at least ${formatDuration(MINIMUM_BOOKING_MINUTES)}.`,
  operatingHours: `Book between ${OPENS_AT} and ${CLOSES_AT} on one day.`,
  started: spanHint.started,
  horizon: spanHint.horizon,
  sameSpan: 'Pick a different station or span.',
};

export const applyMessage = {
  emailTaken: 'An account already uses that email.',
  controlCharacters: 'Use letters, numbers and punctuation only.',
  invalidEmail: 'Enter a valid email address.',
  tooLongName: 'Use at most 80 characters.',
  tooLongPassword: 'Use at most 200 characters.',
  required: 'Fill in this field.',
  shortPassword: 'Use at least 10 characters.',
};

export const uploadMessage = {
  fileType: 'Upload a PDF, PNG or JPEG file.',
  fileSize: 'That file is too large.',
  pastDate: 'That date has already passed.',
  limit: "Coverage is below the kitchen's minimum per occurrence.",
  additionalInsured: `The certificate must name ${KITCHEN_NAME} as additional insured.`,
};

export const serverMessage = {
  crossOrigin: 'This request came from another site.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'Your role cannot use this.',
  notFound: "That record isn't available.",
  malformedBody: 'The request body could not be read.',
  payloadTooLarge: 'That request is too large.',
  unsupportedMediaType: 'Send this request as JSON.',
  internalError: 'Something went wrong on our side.',
  idempotencyKeyRequired: 'This request needs an Idempotency-Key header.',
  idempotencyConflict: 'This Idempotency-Key was already used with a different request.',
  idempotencyInProgress: 'An earlier request with this Idempotency-Key is still running.',
  storageUnavailableUpload: 'Document storage is unreachable. Nothing was saved; try again shortly.',
  storageUnavailableRead: 'Previews are unavailable while document storage is unreachable.',
  billingUnavailablePurchase: 'Billing is unreachable. Nothing was charged.',
  billingUnavailableRefund: 'Billing is unreachable. No refund was issued.',
  purchasePending: 'Payment taken, but your hours are not on file yet. Press the same button again to finish.',
  reauthRequired: 'Confirm your password to continue.',
  rateLimited: 'Too many claims in the last minute. Try again shortly.',
  invalidCredentials: "That email and password don't match an account.",
  passwordMismatch: "That password doesn't match your account.",
  signinLimit: 'Too many sign-in attempts for that email. Try again in a few minutes.',
  unacceptedField: 'This field is not accepted.',
  validationFailed: 'Check the fields and try again.',
  cleanupBox: 'Confirm the station was cleaned and sanitised.',
  noteTooLong: 'Use at most 500 characters.',
  tenantNotApproved: 'This account cannot book yet.',
  documentsNotValid: 'Those documents do not cover that date.',
  insufficientHours: 'No single pack has those hours available.',
  slotTaken: 'Someone else claimed that span.',
  holdExpired: 'That hold ran out.',
  invalidTransition: 'That change is not allowed from this state.',
  pastCutoff: 'That booking is past its cutoff.',
  moveLimitReached: 'That booking has already been moved.',
  outsideCheckInWindow: 'Too early or too late to check in this booking.',
  notCleared: 'That tenant is not cleared for the floor.',
  tooEarly: "The booking hasn't started yet.",
  packInUse: 'This pack has a booking or hold on it, so it cannot be refunded.',
  packEmpty: 'This pack has no hours left to refund.',
  refundAmountChanged: 'The refundable amount changed.',
  expectedCents: 'Send the refundable amount shown on screen.',
  badDate: 'Use a calendar date as YYYY-MM-DD.',
  dateRequired: 'Pick a date.',
  badSpan: 'Use half-hour times inside operating hours with the start before the end.',
  tenantIdRequired: 'Name a tenant.',
  packHours: 'Pick a 10-, 20- or 40-hour pack.',
  fileMissing: 'Choose a file to upload.',
  fileNotFound: 'That document has no file.',
  kindInvalid: 'Pick a document type.',
  expiresOnInvalid: 'Use a calendar date as YYYY-MM-DD.',
  limitInvalid: 'Enter the per-occurrence limit in whole dollars.',
  additionalInsuredInvalid: 'Answer true or false.',
  emailRequired: 'Fill in this field.',
  passwordRequired: 'Fill in this field.',
};

export const PACK_CATALOGUE: ReadonlyArray<{ hours: number; priceCents: number }> = [
  { hours: 10, priceCents: 26000 },
  { hours: 20, priceCents: 48000 },
  { hours: 40, priceCents: 88000 },
];

export const STEP_UP_PACK_HOURS: ReadonlyArray<number> = [20, 40];

export const MINIMUM_PER_OCCURRENCE_LIMIT = 1000000;
