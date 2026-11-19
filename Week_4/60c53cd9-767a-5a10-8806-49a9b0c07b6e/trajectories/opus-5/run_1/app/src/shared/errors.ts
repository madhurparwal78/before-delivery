/** The published error codes, messages and field messages. */

export type ErrorCode =
  | 'unauthenticated'
  | 'sign_in_failed'
  | 'cross_origin'
  | 'forbidden'
  | 'not_found'
  | 'read_only'
  | 'unit_unavailable'
  | 'unit_reserved'
  | 'price_changed'
  | 'hold_limit'
  | 'hold_cooldown'
  | 'hold_ended'
  | 'idempotency_key_reused'
  | 'already_released'
  | 'not_released'
  | 'unit_withdrawn'
  | 'upload_in_progress'
  | 'stale_price'
  | 'too_large'
  | 'unsupported_type'
  | 'unsupported_image'
  | 'invalid'
  | 'search_rate_limited'
  | 'hold_attempts'
  | 'upload_unconfirmed'
  | 'search_unavailable'
  | 'storage_unavailable'
  | 'media_unavailable';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  sign_in_failed: 401,
  cross_origin: 403,
  forbidden: 403,
  not_found: 404,
  read_only: 405,
  unit_unavailable: 409,
  unit_reserved: 409,
  price_changed: 409,
  hold_limit: 409,
  hold_cooldown: 409,
  hold_ended: 409,
  idempotency_key_reused: 409,
  already_released: 409,
  not_released: 409,
  unit_withdrawn: 409,
  upload_in_progress: 409,
  stale_price: 412,
  too_large: 413,
  unsupported_type: 415,
  unsupported_image: 415,
  invalid: 422,
  search_rate_limited: 429,
  hold_attempts: 429,
  upload_unconfirmed: 502,
  search_unavailable: 503,
  storage_unavailable: 503,
  media_unavailable: 503,
};

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  sign_in_failed: "That email and password don't match an account.",
  cross_origin: 'This request must come from the Highwater site.',
  forbidden: "Your account can't do that.",
  not_found: "We couldn't find that.",
  read_only: 'Shared links are read-only.',
  unit_unavailable: 'Someone else holds this home now.',
  unit_reserved: 'This home is already reserved.',
  price_changed: 'The price of this home changed. Check the new price and confirm again.',
  hold_limit: 'You already hold a home. Release it before holding another.',
  hold_cooldown: 'You held this home recently. You can hold it again after <end time>.',
  hold_ended: 'This hold has already ended.',
  idempotency_key_reused: 'This request key was already used for a different request.',
  already_released: 'These floors are already released.',
  not_released: "These floors aren't released yet.",
  unit_withdrawn: 'This home has been withdrawn.',
  upload_in_progress: 'Another photo for this home is still uploading.',
  stale_price: 'Someone changed this price first. Reload and try again.',
  too_large: 'That request is too large.',
  unsupported_type: 'Send JSON.',
  unsupported_image: 'Upload a PNG or JPEG image.',
  invalid: 'Check the highlighted fields.',
  search_rate_limited: 'Too many searches from this device. Try again in <seconds> seconds.',
  hold_attempts: 'Too many hold attempts. Try again in <seconds> seconds.',
  upload_unconfirmed: 'The photo could not be confirmed. Upload it again.',
  search_unavailable: 'Search is down for a moment. The tower still shows live availability.',
  storage_unavailable: 'Photo storage is unavailable. The photo was not saved.',
  media_unavailable: "This file can't be loaded right now.",
};

export const FIELD_MESSAGES = {
  name: 'Use 1 to 80 characters.',
  email: 'Enter a valid email address.',
  password: 'Use 10 to 200 characters.',
  qTooLong: 'Use 80 characters or fewer.',
  facetTooMany: 'Choose up to 6.',
  facetUnknown: 'Pick from the listed options.',
  priceBound: 'Enter a whole number of dollars.',
  priceMinAboveMax: "The lowest price can't be above the highest.",
  limit: 'Use a page size from 1 to 24.',
  cursor: 'This page link is out of date. Start again.',
  unitCode: 'Choose a home.',
  priceVersion: "Reload this home's price.",
  idempotencyKey: 'Use 1 to 100 visible characters.',
  price: 'Enter a whole number from 100000 to 20000000.',
  expectedVersion: "Enter the price version you're changing.",
  photoTooSmall: 'Use an image at least 1024 by 512 pixels.',
  photoUnreadable: 'Upload a readable PNG or JPEG image.',
} as const;

export function errorMessage(code: ErrorCode, placeholders?: Record<string, string>): string {
  let message: string = ERROR_MESSAGES[code];
  if (placeholders) {
    for (const [key, value] of Object.entries(placeholders)) {
      message = message.replace(`<${key}>`, value);
    }
  }
  return message;
}
