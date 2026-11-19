// The single error shape (API: Error shape) and the published messages.
export type FieldErrors = Record<string, string>;

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: FieldErrors };
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  fields?: FieldErrors;
}

export function apiError(status: number, code: string, message: string, fields?: FieldErrors): ApiError {
  const err: ApiError = { status, code, message };
  if (status === 422 && fields && Object.keys(fields).length > 0) err.fields = fields;
  return err;
}

export function apiErrorBody(err: ApiError): ApiErrorBody {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
  if (err.status === 422 && err.fields) body.error.fields = err.fields;
  return body;
}

export const MSG = {
  unauthenticated: 'Sign in to continue.',
  signInFailed: "That email and password don't match an account.",
  crossOrigin: 'This request must come from the Highwater site.',
  forbidden: "Your account can't do that.",
  notFound: "We couldn't find that.",
  readOnly: 'Shared links are read-only.',
  unitUnavailable: 'Someone else holds this home now.',
  unitReserved: 'This home is already reserved.',
  priceChanged: 'The price of this home changed. Check the new price and confirm again.',
  holdLimit: 'You already hold a home. Release it before holding another.',
  holdCooldown: (when: string) => `You held this home recently. You can hold it again after ${when}.`,
  holdEnded: 'This hold has already ended.',
  idempotencyKeyReused: 'This request key was already used for a different request.',
  alreadyReleased: 'These floors are already released.',
  notReleased: "These floors aren't released yet.",
  unitWithdrawn: 'This home has been withdrawn.',
  uploadInProgress: 'Another photo for this home is still uploading.',
  stalePrice: 'Someone changed this price first. Reload and try again.',
  tooLarge: 'That request is too large.',
  unsupportedType: 'Send JSON.',
  unsupportedImage: 'Upload a PNG or JPEG image.',
  invalid: 'Check the highlighted fields.',
  searchRateLimited: (seconds: number) => `Too many searches from this device. Try again in ${seconds} seconds.`,
  holdAttempts: (seconds: number) => `Too many hold attempts. Try again in ${seconds} seconds.`,
  uploadUnconfirmed: 'The photo could not be confirmed. Upload it again.',
  searchUnavailable: 'Search is down for a moment. The tower still shows live availability.',
  storageUnavailable: 'Photo storage is unavailable. The photo was not saved.',
  mediaUnavailable: "This file can't be loaded right now.",
} as const;

export const FIELD_MSG = {
  name: 'Use 1 to 80 characters.',
  email: 'Enter a valid email address.',
  password: 'Use 10 to 200 characters.',
  q: 'Use 80 characters or fewer.',
  facet: 'Choose up to 6.',
  facetValue: 'Pick from the listed options.',
  price: 'Enter a whole number of dollars.',
  priceOrder: "The lowest price can't be above the highest.",
  limit: 'Use a page size from 1 to 24.',
  after: 'This page link is out of date. Start again.',
  unitCode: 'Choose a home.',
  priceVersion: "Reload this home's price.",
  idempotencyKey: 'Use 1 to 100 visible characters.',
  consolePrice: 'Enter a whole number from 100000 to 20000000.',
  expectedVersion: "Enter the price version you're changing.",
  photoSmall: 'Use an image at least 1024 by 512 pixels.',
  photoCorrupt: 'Upload a readable PNG or JPEG image.',
  base: 'Check the highlighted fields.',
} as const;
