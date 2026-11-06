import type { AcceptedStatus } from '../domain/status';

export type FieldErrors = Record<string, string>;

/** The one error shape: `{"error":"<code>","message":"<plain sentence>"}` plus named extras. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail);
    this.name = 'ApiError';
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.detail, ...this.extra };
  }
}

export const FIELD_MESSAGES = {
  name: 'Enter a name',
  age: 'Enter an age from 0 to 125',
  gender: 'Choose a gender',
  berthPreference: 'Choose a berth preference',
  atLeastOneAdult: 'Add at least one passenger aged 5 or over',
  tooManyAdults: 'Up to 6 passengers aged 5 or over',
  tooManyChildren: 'Up to 2 children under five',
  tooManyTatkal: 'Up to 4 passengers aged 5 or over on a Tatkal ticket',
  tooManySenior: 'Up to 2 passengers on a Senior quota ticket',
  ladiesGender: 'Ladies quota is for women travellers',
  seniorAge: 'Senior quota is for passengers aged 60 or over, or women aged 45 or over',
  phone: 'Enter +91 and a 10-digit mobile number',
  email: 'Enter a valid email',
  password: 'Use at least 10 characters',
  travelClass: 'Choose SL or 3A',
  quota: 'Choose GN, TQ, LD or SS',
  accept: 'Choose CNF, RAC or WL',
  date: 'Enter a date as YYYY-MM-DD',
  sameStation: 'Choose a different station from From',
  notOnRoute: 'This train does not call at these stops in this order',
  choosePassenger: 'Choose at least one passenger',
  notOnPnr: (number: number): string => `Passenger ${number} is not on this PNR`,
} as const;

export const errors = {
  tooLarge: (): ApiError =>
    new ApiError(413, 'too_large', 'The request body is larger than 65536 bytes.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'Request bodies must be application/json.'),
  badJson: (): ApiError => new ApiError(400, 'bad_json', 'The request body is not valid JSON.'),
  idempotencyKeyRequired: (): ApiError =>
    new ApiError(400, 'idempotency_key_required', 'This request needs an Idempotency-Key header.'),
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'This request came from another origin.'),
  unauthenticated: (): ApiError =>
    new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  idempotencyConflict: (): ApiError =>
    new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was used with a different body.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Nothing here.'),
  bookingNotOpen: (opensAt: string): ApiError =>
    new ApiError(409, 'booking_not_open', 'Bookings for this train are not open yet.', { opens_at: opensAt }),
  tatkalNotOpen: (opensAt: string): ApiError =>
    new ApiError(409, 'tatkal_not_open', 'Tatkal booking is not open yet.', { opens_at: opensAt }),
  chartPrepared: (): ApiError =>
    new ApiError(409, 'chart_prepared', 'The chart for this train is prepared.'),
  alreadyCancelled: (): ApiError =>
    new ApiError(409, 'already_cancelled', 'That passenger is already cancelled.'),
  journeyComplete: (): ApiError =>
    new ApiError(409, 'journey_complete', 'This journey is complete.'),
  validation: (fields: FieldErrors): ApiError =>
    new ApiError(422, 'validation', 'Check these fields', { errors: fields }),
  quotaFull: (quotaLabel: string): ApiError =>
    new ApiError(409, 'quota_full', `Not enough ${quotaLabel} quota berths are left.`,
      { charged: false }),
  waitlistFull: (): ApiError =>
    new ApiError(409, 'waitlist_full', 'The waiting list for this train is full.', { charged: false }),
  partySplit: (): ApiError =>
    new ApiError(409, 'party_split', 'The party could not be kept in one coach.', { charged: false }),
  noLowerBerth: (): ApiError =>
    new ApiError(409, 'no_lower_berth', 'No lower berth could be allotted.', { charged: false }),
  availabilityChanged: (accept: AcceptedStatus, label: string): ApiError =>
    new ApiError(409, 'availability_changed', 'Availability changed before you paid.', {
      charged: false,
      offer: { accept, label },
    }),
  paymentUnavailable: (): ApiError =>
    new ApiError(503, 'payment_unavailable', 'Payments are down right now.'),
  ticketStorageUnavailable: (): ApiError =>
    new ApiError(503, 'ticket_storage_unavailable', 'E-tickets cannot be stored right now.'),
  emailTaken: (): ApiError =>
    new ApiError(409, 'email_taken', 'An account already uses this email.'),
  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', 'Email or password is wrong.'),
  databaseNotReady: (): ApiError =>
    new ApiError(503, 'database_not_ready', 'The database is not ready yet.'),
};
