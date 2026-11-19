import { formatMoney } from '../../shared/money';
import { PlainDate } from '../../shared/dates';

export type ErrorBody = { error: string } | { errors: Record<string, string> };

/** Every API failure is raised as one of these and rendered by the one error shape. */
export class ApiError extends Error {
  readonly status: number;

  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super('error' in body ? body.error : JSON.stringify(body.errors));
    this.status = status;
    this.body = body;
  }
}

export function failure(status: number, text: string, extra?: Record<string, unknown>): ApiError {
  const body = { error: text, ...(extra ?? {}) } as ErrorBody;
  return new ApiError(status, body);
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(422, { errors: fields });
}

export const errorTexts = {
  notSignedIn: 'Please sign in.',
  notFound: 'Not found.',
  badCredentials: 'That email or password is not right.',
  sendJson: 'Send JSON.',
  tooLarge: 'That request is too large.',
  cannotCheckIn: 'This stay cannot be checked in.',
  cannotCheckOut: 'This stay cannot be checked out.',
  cannotCancel: 'This stay can no longer be cancelled.',
  cannotMove: 'That stay cannot be moved.',
  arrivesOn: (arrival: PlainDate, businessDate: PlainDate): string =>
    `This stay arrives on ${arrival}, not on business date ${businessDate}.`,
  roomNotReadyForCheckIn: (roomNumber: string, status: string): string =>
    `Room ${roomNumber} is ${status} and cannot be checked in.`,
  departsLater: (departure: PlainDate): string =>
    `This stay departs on ${departure}. Change its dates before checking out early.`,
  inHouseArrival: 'An in-house stay cannot change its arrival.',
  roomJustTaken: (roomNumber: string): string =>
    `Room ${roomNumber} was just taken. Choose another room.`,
  staleVersion: 'This stay was changed by someone else. It now shows the latest.',
  roomOccupied: (roomNumber: string, date: PlainDate): string =>
    `Room ${roomNumber} is occupied on ${date}.`,
  roomNotReadyForMove: (roomNumber: string, status: string): string =>
    `Room ${roomNumber} is ${status} and cannot take an in-house guest.`,
  statusChangeNotAllowed: 'That room status change is not allowed.',
  closeNotOpen: 'The business day has not ended. The close opens at 04:00.',
  alreadyClosed: 'This business date is already closed.',
  notCheckedOut: (roomNumber: string): string => `Room ${roomNumber} has not checked out.`,
  entryLocked: 'This entry cannot be changed again.',
  folioClosed: 'This folio is closed.',
  folioHasBalance: (balanceCents: number): string =>
    `This folio still has a balance of ${formatMoney(balanceCents)}.`,
  folioNoEntries: 'This folio has no entries.',
  linkClosed: 'This stay is no longer waiting for check-in.',
  deadLink: 'This check-in link is no longer valid.',
  photoTooLarge: 'That photo is too large.',
  photoWrongType: 'Please upload a JPEG or PNG photo.',
  uploadPhotoFirst: 'Please upload your ID photo first.',
  idempotencyMismatch: 'This request was already used for a different stay.',
} as const;

export const validationTexts = {
  guestName: "Enter the guest's name.",
  guestEmail: 'Enter a valid email address.',
  arrivalBeforeBusinessDate: 'Arrival cannot be before the business date.',
  departureAfterArrival: 'Departure must be after arrival.',
  stayTooLong: 'Stays are limited to 90 nights.',
  departureBeforeBusinessDate: 'Departure cannot be before the business date.',
  guestsRange: 'Guests must be between 1 and 6.',
  chooseRoom: 'Choose a room.',
  chooseRatePlan: 'Choose a rate plan.',
  idempotencyKey: 'Send an Idempotency-Key header.',
  percents: 'Enter 2 to 4 whole percentages that add up to 100.',
  amountAboveZero: 'Enter an amount above zero.',
  terminalReference: 'Enter the terminal reference.',
  payerEmail: "Enter the payer's email address.",
  taxPercent: 'Enter a rate from 0 to 30 with at most two decimals.',
  taxStartDate: 'The start date must be after the business date.',
  fromNight: 'Choose a night of this stay that is not before the business date.',
  moveNotBooked: 'Only a booked stay can change its dates this way.',
  moveBothFields: 'Send arrival or fromNight, not both.',
  differentGuests: 'Choose two different guests.',
  dateRange: 'Enter a valid date range.',
  fullName: 'Enter your full name.',
} as const;

export const outageTexts = {
  invoicePdfService:
    'The invoice could not be created. The PDF service is unavailable. Nothing was saved.',
  invoiceFileStore:
    'The invoice could not be created. The file store is unavailable. Nothing was saved.',
  photoFileStore: 'Your photo could not be saved. Please try again.',
  fileStoreRead: 'The file store is unavailable.',
  invoiceMail: 'The invoice could not be emailed. The mail service is unavailable.',
  checkinLinkMail: 'The check-in link could not be sent. The mail service is unavailable.',
} as const;

export const notFoundError = (): ApiError => failure(404, errorTexts.notFound);
