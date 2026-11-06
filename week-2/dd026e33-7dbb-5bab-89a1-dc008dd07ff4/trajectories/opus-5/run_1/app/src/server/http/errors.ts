import type { ApiErrorBody, HoldingInvoice, Item } from '../../shared/types';

/** Every API error goes through this single shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(typeof body.error === 'string' ? body.error : 'invalid');
    this.name = 'ApiError';
  }
}

export type ConflictCode =
  | 'bay_occupied'
  | 'bay_too_small'
  | 'bay_class_change'
  | 'car_released'
  | 'car_not_stored'
  | 'car_in_workshop'
  | 'insufficient_items'
  | 'report_already_signed'
  | 'job_already_open'
  | 'invalid_transition'
  | 'estimate_expired'
  | 'stage_already_logged'
  | 'stage_out_of_order'
  | 'release_already_open'
  | 'slot_taken'
  | 'already_paid'
  | 'cannot_change_own_access'
  | 'idempotency_conflict';

export type FieldErrors = Record<string, string>;

export const fail = {
  unauthenticated: (): ApiError => new ApiError(401, { error: 'unauthenticated' }),
  accessRevoked: (): ApiError => new ApiError(401, { error: 'access_revoked' }),
  sessionExpired: (): ApiError => new ApiError(401, { error: 'session_expired' }),
  invalidCredentials: (): ApiError => new ApiError(401, { error: 'invalid_credentials' }),
  forbidden: (): ApiError => new ApiError(403, { error: 'forbidden' }),
  notFound: (): ApiError => new ApiError(404, { error: 'not_found' }),
  conflict: (code: ConflictCode): ApiError => new ApiError(409, { error: code }),
  belongingsCheckedIn: (items: Item[]): ApiError =>
    new ApiError(409, { error: 'belongings_checked_in', items }),
  invoiceUnpaid: (invoices: HoldingInvoice[]): ApiError =>
    new ApiError(409, { error: 'invoice_unpaid', invoices }),
  estimateChanged: (): ApiError => new ApiError(412, { error: 'estimate_changed' }),
  payloadTooLarge: (): ApiError => new ApiError(413, { error: 'payload_too_large' }),
  unsupportedMediaType: (): ApiError => new ApiError(415, { error: 'unsupported_media_type' }),
  validation: (errors: FieldErrors): ApiError => new ApiError(422, { errors }),
  storageUnavailable: (): ApiError => new ApiError(503, { error: 'storage_unavailable' }),
  billingUnavailable: (): ApiError => new ApiError(503, { error: 'billing_unavailable' }),
  mailUnavailable: (): ApiError => new ApiError(503, { error: 'mail_unavailable' }),
};

/** Thrown when the client goes away mid-request; nothing is answered. */
export class ClientGone extends Error {
  constructor() {
    super('The client disconnected');
    this.name = 'ClientGone';
  }
}

export const VALIDATION_MESSAGES = {
  credentials: 'Enter your email and password.',
  year: (currentYear: number) => `Enter a year from 1886 to ${currentYear}.`,
  text60: 'Enter 1 to 60 characters.',
  registration: 'Enter 1 to 20 characters.',
  length: 'Enter a length from 2000 to 7000 mm.',
  width: 'Enter a width from 1200 to 2600 mm.',
  odometer: 'Enter a whole odometer reading from 0 to 9999999.',
  pressure: 'Enter a pressure from 0.50 to 5.00 bar.',
  count: 'Enter a whole number from 0 to 20.',
  movementCount: 'Enter a whole number from 1 to 20.',
  reportFile: 'Upload a PDF.',
  photoFile: 'Upload a JPEG or PNG image.',
  entry: 'Record a start-up, a battery voltage or tyre pressures.',
  battery: 'Enter a voltage from 0.00 to 16.00 V.',
  tyres: 'Enter all four tyres from 0.50 to 5.00 bar.',
  note: 'Keep the note under 500 characters.',
  title: 'Enter 1 to 120 characters.',
  lines: 'Add at least one line.',
  description: 'Enter 1 to 120 characters.',
  partQuantity: 'Enter a whole number of parts from 1 to 999.',
  labourQuantity: 'Enter hours in quarter-hour steps from 0.25 to 200.00.',
  paintQuantity: 'Enter a quantity greater than zero with up to two decimals.',
  unitPrice: 'Enter a price in CHF from 0.01 to 99999.99.',
  labourPrice: 'Labour is billed at the house rate.',
  ifMatch: 'Send the estimate version you edited.',
  idempotencyKey: 'Send an Idempotency-Key header.',
  stageName: 'Choose a stage from the list.',
  intakeReadings: 'Intake needs a reading for every panel.',
  someReadings: 'Add at least one reading.',
  panel: 'Choose a panel from the list.',
  readingUm: 'Enter a reading from 0 to 2000 µm.',
  readingMil: 'Enter a reading from 0.0 to 78.7 mil.',
  reference: 'Enter 1 to 60 characters.',
  amount: (balance: string) => `Enter an amount from 0.01 to ${balance}.`,
  slotFormat: 'Use a date and time like 2026-11-03T10:30.',
  slotGrid: 'Choose a half-hour slot between 08:00 and 17:30, Monday to Saturday.',
  slotNotice: "Releases need at least 48 hours' notice.",
  units: 'Choose one of the listed units.',
} as const;
