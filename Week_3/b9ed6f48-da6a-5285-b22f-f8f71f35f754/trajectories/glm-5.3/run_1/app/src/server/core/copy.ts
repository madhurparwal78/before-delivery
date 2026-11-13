import type { Currency } from './money.ts';
import { formatPrice } from './money.ts';

/** Published copy. Straight apostrophes and double quotes, character for character. */

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden_origin'
  | 'forbidden'
  | 'validation_failed'
  | 'email_taken'
  | 'invalid_credentials'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'booking_closed'
  | 'sold_out'
  | 'card_declined'
  | 'currency_locked'
  | 'already_member'
  | 'same_tier'
  | 'change_pending'
  | 'payment_overdue'
  | 'nothing_pending'
  | 'nothing_due'
  | 'not_a_member'
  | 'illegal_transition'
  | 'not_editable'
  | 'lead_only'
  | 'session_not_cancellable'
  | 'fully_refunded'
  | 'price_change_conflict'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'accounts_unavailable';

export const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: 'Please sign in.',
  not_found: "We couldn't find that.",
  forbidden_origin: 'Request refused.',
  forbidden: "You can't change this item.",
  validation_failed: 'Check the highlighted fields.',
  email_taken: 'An account with this email already exists.',
  invalid_credentials: 'Email or password is incorrect.',
  idempotency_key_required: 'Missing idempotency key.',
  idempotency_conflict: 'This request key was already used for a different request.',
  payload_too_large: 'That request is too large.',
  unsupported_media_type: 'Send JSON.',
  booking_closed: 'Booking for this session has closed.',
  sold_out: 'Not enough seats left for this session.',
  card_declined: 'Your card was declined. You have not been charged.',
  currency_locked: 'Choose your supporter account currency to continue.',
  already_member: "You're already a supporter. Change your plan instead.",
  same_tier: "You're already on the %TIER% tier.",
  change_pending: 'Undo your pending change before making another.',
  payment_overdue: 'Settle your overdue payment before changing your plan.',
  nothing_pending: "There's no pending change to undo.",
  nothing_due: "There's nothing to pay right now.",
  not_a_member: "You don't have a supporter membership.",
  illegal_transition: "That move isn't allowed from %STATUS%.",
  not_editable: 'Only drafts can be edited.',
  lead_only: 'Only the lead curator can schedule items.',
  session_not_cancellable: 'This session can no longer be cancelled.',
  fully_refunded: 'This order is already fully refunded.',
  price_change_conflict: 'A later price change is already scheduled.',
  billing_unavailable: 'Payments are unavailable right now. You have not been charged. Please try again shortly.',
  storage_unavailable: "We can't issue tickets or receipts right now. You have not been charged. Please try again shortly.",
  accounts_unavailable: "Accounts are unavailable right now. You can keep exploring, but your path won't be saved until they're back.",
};

/** Replace %TIER% / %STATUS% placeholders with concrete values. */
export function message(code: ErrorCode, vars?: { tier?: string; status?: string }): string {
  let m = MESSAGES[code];
  if (code === 'currency_locked') {
    return 'Choose your supporter account currency to continue.';
  }
  m = m.replace('%TIER%', vars?.tier ?? '').replace('%STATUS%', vars?.status ?? '');
  return m;
}

export function currencyLockedMessage(accountCurrency: string): string {
  return `Your supporter account pays in ${accountCurrency}. Choose ${accountCurrency} to continue.`;
}

export function illegalTransition(status: string): string {
  return `That move isn't allowed from ${status}.`;
}

export function sameTierMessage(tierName: string): string {
  return `You're already on the ${tierName} tier.`;
}

/** Field error copy. */
export const FIELDS = {
  name: 'Enter your name.',
  email: 'Enter a valid email address.',
  password: 'Use 10 to 72 characters.',
  card: 'Enter a valid card number.',
  seats: 'Choose between 1 and 4 seats.',
  donationAmount(minMinor: number, maxMinor: number, currency: Currency): string {
    return `Enter an amount between ${formatPrice(minMinor, currency)} and ${formatPrice(maxMinor, currency)}.`;
  },
  amountFormat: 'Enter an amount such as 25.00, or a whole number for yen.',
  publishTime: 'Choose a time after now.',
  publishTimeFormat: 'Choose a time after now.',
  skippedLisbonTime: "That time doesn't exist in Lisbon because the clocks go forward. Choose another time.",
  reason: 'Give a reason of 3 to 500 characters.',
  sessionTitle: 'Give a title of 3 to 120 characters.',
  sessionStart: 'Choose a time after now.',
  duration: 'Choose between 15 and 240 minutes.',
  capacity: 'Choose between 1 and 200 seats.',
  effectiveDate: 'Choose a date after today.',
  refundCap(remainingMinor: number, currency: Currency): string {
    return `Refund can't exceed ${formatPrice(remainingMinor, currency)}.`;
  },
  uploadType: "This file type isn't accepted here.",
  uploadSize: 'Files must be 20,000,000 bytes or smaller.',
  transcript: 'Narration needs a transcript.',
  citation: 'Citations are 5 to 300 characters.',
} as const;

export const COPY = {
  resolution: (numeral: string) => `Chapter ${numeral} resolved.`,
  emptyEvents: 'No timeline events in this chapter yet.',
  notFoundHeading: "We couldn't find that room.",
  mediaUnavailable: 'This media is unavailable right now.',
  booked: (seats: number, title: string) =>
    seats === 1 ? `Booked 1 seat for ${title}.` : `Booked ${seats} seats for ${title}.`,
  donationReceived: (price: string) => `Donation of ${price} received.`,
  processing: 'Processing payment, please wait.',
  receiptDelayed: 'Your receipt email is delayed. It will arrive once our mail service is back.',
  pricesUnavailable: 'Prices are unavailable right now.',
  storageUnavailableMedia: 'This media is unavailable right now.',
  mediaUploadUnavailable: 'Media storage is unavailable right now. Your file was not uploaded.',
  pricesUnavailableForPlan: 'Prices are unavailable right now.',
} as const;
