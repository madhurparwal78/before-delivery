import { config } from './config';
import { formatDateIst, groupIndian, rupees } from './domain/money';

export type ErrorBody = {
  error: string;
  message: string;
  fields?: Record<string, string>;
  sku?: string;
  available?: number;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ErrorBody;

  constructor(status: number, code: string, message: string, extra: Partial<ErrorBody> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = { error: code, message, ...extra };
  }
}

export const MESSAGES = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: "That email and password don't match.",
  not_found: "We couldn't find that.",
  forbidden: "You don't have permission to do that.",
  cross_origin: 'Requests must come from the Roam House site.',
  method_not_allowed: "That action isn't allowed here.",
  method_not_allowed_audit: "Audit entries can't be changed.",
  idempotency_mismatch: 'This request was already used with different details. Start again.',
  stale_version: 'This record changed since you opened it. Reload to see the latest version.',
  reservation_expired: 'Your hold has ended and the items went back on sale. Press Pay to hold them again.',
  invalid_transition: "That change isn't possible from the current status.",
  duplicate_request: "There's already an open request for this item.",
  email_taken: 'An account with this email already exists.',
  too_large_request: 'This request is too large.',
  unsupported_media_type: 'Send the request as JSON.',
  validation_failed: 'Check the highlighted fields.',
  not_eligible: "This item isn't eligible for that request.",
  code_invalid: "We don't recognise that code.",
  code_exhausted: 'This code has been fully used.',
  code_not_applicable: "This code doesn't apply to anything in your bag.",
  unsupported_file: 'Use a JPEG, PNG or WebP photo, or a PDF receipt.',
  unsupported_file_image: 'Use a JPEG, PNG or WebP image.',
  card_declined: 'Your card was declined. No money was taken. Try another card.',
  insufficient_funds: "Your card doesn't have enough funds. No money was taken. Try another card.",
  storage_unavailable_image: 'Image storage is unavailable. Nothing was published. Try again.',
  storage_unavailable_evidence: 'Evidence storage is unavailable. Nothing was saved. Try again.',
  email_unavailable: "We couldn't send your confirmation, so the order wasn't placed. Your bag is still held. Try again."
} as const;

export const FIELD_COPY = {
  email: 'Enter an email address like name@example.com.',
  phone: 'Enter a 10-digit mobile number.',
  addressName: "Enter the recipient's full name.",
  line1: 'Enter the first line of the address.',
  line2: 'Keep address line 2 to 100 characters or fewer.',
  city: 'Enter a town or city.',
  state: 'Choose a state.',
  postcode: 'Enter a 6-digit PIN code.',
  label: 'Give the address a label of 1 to 30 characters.',
  method: 'Choose a shipping method.',
  giftMessage: 'Keep the gift message to 200 characters or fewer.',
  cardNumber: 'Enter a 16-digit card number.',
  cardExpiry: 'Enter an expiry date in the future, as MM/YY.',
  cardCvc: 'Enter the 3-digit security code.',
  name: 'Enter your name in 1 to 80 characters.',
  password: 'Use a password of at least 10 characters.',
  quantity: 'Choose a quantity from 1 to 10.',
  sku: 'Choose a variant from the catalogue.',
  code: 'Enter a code.',
  cart: 'Your bag is empty.',
  reason: 'Choose a reason.',
  outcome: 'Choose a refund or an exchange.',
  exchangeSku: 'Choose another colour or size of the same bag at the same price.',
  note: 'Keep the note to 500 characters or fewer.',
  component: 'Choose the part that failed.',
  description: 'Describe the fault in 20 to 1,000 characters.',
  evidenceIds: 'Add 1 to 5 photos and at most one receipt.',
  kind: 'Choose photo or receipt.',
  file: 'Choose a file to upload.',
  staffReason: 'Give a reason of 5 to 500 characters.',
  price: 'Enter a whole-rupee price from 1 to 9,99,999.',
  compareAt: 'Enter a compare-at price above the price, or leave it empty.',
  stockAvailable: 'Enter a whole number of units from 0 to 9,999.',
  stockLocation: 'Choose bhiwandi or gurugram.',
  productStatus: 'Choose draft, published or archived.',
  orderStatus: 'Choose packed, out for delivery, delivered or cancelled.',
  alt: 'Write alt text of 5 to 160 characters.',
  colour: "Choose one of this product's colours.",
  carrier: 'Choose a carrier.',
  trackingNumber: 'Use 6 to 30 capital letters, digits and hyphens.',
  lineIds: 'Choose at least one line to ship.',
  caseTo: 'Choose a status this case can move to.',
  promoCode: 'Use 3 to 20 capital letters and digits.',
  promoCodeExists: 'That code already exists.',
  promoKind: 'Choose percentage or fixed amount.',
  promoValue: 'Enter a percentage from 1 to 90 or a fixed amount from ₹1 to ₹9,99,999.',
  promoCollection: 'Choose a collection or every line.',
  promoMinimum: 'Enter a minimum spend of ₹0 or more.',
  dateTime: 'Enter a date and time.',
  endsAfterStart: 'End after the start.',
  usageLimit: 'Enter a usage limit of 1 or more, or leave it empty.',
  dateRange: 'Enter a date as YYYY-MM-DD, with From on or before To.',
  airline: 'Choose a listed airline.',
  fitSku: 'Choose a luggage, backpack or tote variant.',
  idempotencyKey: 'Send an Idempotency-Key of 8 to 128 characters.'
} as const;

export const unauthenticated = (): AppError =>
  new AppError(401, 'unauthenticated', MESSAGES.unauthenticated);
export const invalidCredentials = (): AppError =>
  new AppError(401, 'invalid_credentials', MESSAGES.invalid_credentials);
export const notFound = (): AppError => new AppError(404, 'not_found', MESSAGES.not_found);
export const forbidden = (): AppError => new AppError(403, 'forbidden', MESSAGES.forbidden);
export const crossOrigin = (): AppError => new AppError(403, 'cross_origin', MESSAGES.cross_origin);
export const methodNotAllowed = (audit = false): AppError =>
  new AppError(405, 'method_not_allowed', audit ? MESSAGES.method_not_allowed_audit : MESSAGES.method_not_allowed);
export const idempotencyMismatch = (): AppError =>
  new AppError(409, 'idempotency_mismatch', MESSAGES.idempotency_mismatch);
export const staleVersion = (): AppError => new AppError(412, 'stale_version', MESSAGES.stale_version);
export const invalidTransition = (): AppError =>
  new AppError(409, 'invalid_transition', MESSAGES.invalid_transition);
export const duplicateRequest = (): AppError =>
  new AppError(409, 'duplicate_request', MESSAGES.duplicate_request);
export const reservationExpired = (): AppError =>
  new AppError(409, 'reservation_expired', MESSAGES.reservation_expired);
export const emailTaken = (): AppError => new AppError(409, 'email_taken', MESSAGES.email_taken);
export const notEligible = (): AppError => new AppError(422, 'not_eligible', MESSAGES.not_eligible);
export const codeInvalid = (): AppError => new AppError(422, 'code_invalid', MESSAGES.code_invalid);
export const codeExhausted = (): AppError => new AppError(422, 'code_exhausted', MESSAGES.code_exhausted);
export const codeNotApplicable = (): AppError =>
  new AppError(422, 'code_not_applicable', MESSAGES.code_not_applicable);
export const unsupportedMediaType = (): AppError =>
  new AppError(415, 'unsupported_media_type', MESSAGES.unsupported_media_type);
export const cardDeclined = (): AppError => new AppError(402, 'card_declined', MESSAGES.card_declined);
export const insufficientFunds = (): AppError =>
  new AppError(402, 'insufficient_funds', MESSAGES.insufficient_funds);
export const emailUnavailable = (): AppError =>
  new AppError(503, 'email_unavailable', MESSAGES.email_unavailable);

export const validationFailed = (fields: Record<string, string>): AppError =>
  new AppError(422, 'validation_failed', MESSAGES.validation_failed, { fields });

export const tooLargeRequest = (): AppError => new AppError(413, 'too_large', MESSAGES.too_large_request);
export const tooLargeFile = (): AppError =>
  new AppError(413, 'too_large', `This file is larger than ${groupIndian(config.uploadMaxBytes)} bytes.`);

export const unsupportedFile = (image = false): AppError =>
  new AppError(422, 'unsupported_file', image ? MESSAGES.unsupported_file_image : MESSAGES.unsupported_file);

export const storageUnavailable = (image: boolean): AppError =>
  new AppError(503, 'storage_unavailable', image ? MESSAGES.storage_unavailable_image : MESSAGES.storage_unavailable_evidence);

export function outOfStock(sku: string, available: number, variantLabel: string): AppError {
  const message =
    available <= 0
      ? `Sorry, the last ${variantLabel} was just taken.`
      : `Only ${available} left — we updated your bag.`;
  return new AppError(409, 'out_of_stock', message, { sku, available });
}

export const alreadyRedeemed = (balance: number): AppError =>
  new AppError(409, 'already_redeemed', `This gift card has already been used. Its balance is now ${rupees(balance)}.`);

export const codeExpired = (endsAt: Date): AppError =>
  new AppError(422, 'code_expired', `This code expired on ${formatDateIst(endsAt)}.`);

export const minimumNotMet = (shortfall: number): AppError =>
  new AppError(422, 'minimum_not_met', `Add ${rupees(shortfall)} more to use this code.`);

export const windowClosedReturn = (endsAt: Date): AppError =>
  new AppError(422, 'window_closed', `The ${config.returnWindowDays}-day return window ended on ${formatDateIst(endsAt)}.`);

export const windowClosedTrial = (endsAt: Date): AppError =>
  new AppError(422, 'window_closed', `The ${config.trialWindowDays}-day trial ended on ${formatDateIst(endsAt)}.`);

export const warrantyExpired = (endsAt: Date): AppError =>
  new AppError(422, 'warranty_expired', `This item's warranty ended on ${formatDateIst(endsAt)}.`);

export const SEARCH_NOTICE =
  'Search is unavailable. You can still browse and filter, but typo matching and filter counts are off.';
