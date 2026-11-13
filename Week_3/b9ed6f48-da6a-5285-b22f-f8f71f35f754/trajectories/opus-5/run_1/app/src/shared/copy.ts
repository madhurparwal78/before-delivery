import { formatPrice, type Currency } from './money.js';

export type TierKey = 'reader' | 'fellow' | 'patron';
export type TierName = 'Reader' | 'Fellow' | 'Patron';
export type ItemStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'withdrawn';
export type StatusLabel = 'Draft' | 'Review' | 'Scheduled' | 'Published' | 'Withdrawn';

export const TIER_KEYS: TierKey[] = ['reader', 'fellow', 'patron'];
export const TIER_NAMES: Record<TierKey, TierName> = { reader: 'Reader', fellow: 'Fellow', patron: 'Patron' };
export const STATUS_LABELS: Record<ItemStatus, StatusLabel> = {
  draft: 'Draft',
  review: 'Review',
  scheduled: 'Scheduled',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

/* -------------------------------------------------------- exhibition copy */

export const copy = {
  notFoundHeading: "We couldn't find that room.",
  emptyChapterEvents: 'No timeline events in this chapter yet.',
  mediaUnavailable: 'This media is unavailable right now.',
  noWebgl: "Your browser can't show the 3D scene, so here are its viewpoints.",
  currencyLockedHint: 'Your supporter account pays in',
  bookingSuccessHeading: "You're booked",
  donationSuccessHeading: 'Thank you for your donation',
  paymentPending: 'Processing payment, please wait.',
  donationLostReply: 'Connection lost. Press Donate again to finish safely.',
  receiptEmailDelayed: 'Your receipt email is delayed. It will arrive once our mail service is back.',
  pricesUnavailable: 'Prices are unavailable right now.',
  draftSaved: 'Draft saved.',
  sessionCreated: 'Session created.',
  noteAdded: 'Note added.',
  cardUpdated: 'Card updated.',
  reconciliationMatched: 'Matched',
  amountFormat: 'Enter an amount such as 25.00, or a whole number for yen.',
  skippedTime: "That time doesn't exist in Lisbon because the clocks go forward. Choose another time.",
  timeAfterNow: 'Choose a time after now.',
  dateAfterToday: 'Choose a date after today.',
  reasonLength: 'Give a reason of 3 to 500 characters.',
  titleLength: 'Give a title of 3 to 120 characters.',
  durationRange: 'Choose between 15 and 240 minutes.',
  capacityRange: 'Choose between 1 and 200 seats.',
  seatsRange: 'Choose between 1 and 4 seats.',
  cardInvalid: 'Enter a valid card number.',
  nameRequired: 'Enter your name.',
  emailInvalid: 'Enter a valid email address.',
  passwordLength: 'Use 10 to 72 characters.',
  uploadType: "This file type isn't accepted here.",
  uploadSize: 'Files must be 20,000,000 bytes or smaller.',
  transcriptRequired: 'Narration needs a transcript.',
} as const;

export function resolutionAnnouncement(numeral: string): string {
  return `Chapter ${numeral} resolved.`;
}

export function springAnnouncement(regime: string): string {
  return `Spring is ${regime}.`;
}

export function ruleResultsAnnouncement(classified: number): string {
  return `${classified} of 12 specimens classified.`;
}

export function accuracyAnnouncement(accuracy: string): string {
  return `Held-out accuracy ${accuracy}%.`;
}

export function trainingFinishedAnnouncement(accuracy: string, epochs: number): string {
  return `Training finished. Held-out accuracy ${accuracy}% after ${epochs} epochs.`;
}

export function neighbourAnnouncement(word: string, context: string | null, neighbours: string[]): string {
  const list = neighbours.join(', ');
  return context ? `Nearest to ${word} near ${context}: ${list}.` : `Nearest to ${word}: ${list}.`;
}

export function searchStatus(count: number, query: string): string {
  return count === 1 ? `1 result for "${query}".` : `${count} results for "${query}".`;
}

export function searchEmpty(query: string): string {
  return `Nothing in the archive matches "${query}".`;
}

export function bookmarkedNotice(title: string): string {
  return `Bookmarked ${title}.`;
}

export const bookmarkRemovedNotice = 'Bookmark removed.';

export function signedInNotice(name: string): string {
  return `Signed in as ${name}.`;
}

/* ------------------------------------------------------------ error codes */

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'forbidden_origin'
  | 'lead_only'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_failed'
  | 'email_taken'
  | 'invalid_credentials'
  | 'accounts_unavailable'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'card_declined'
  | 'booking_closed'
  | 'sold_out'
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
  | 'session_not_cancellable'
  | 'fully_refunded'
  | 'price_change_conflict';

export interface ErrorContext {
  accountCurrency?: Currency;
  tierName?: TierName;
  statusLabel?: StatusLabel;
  storageContext?: 'purchase' | 'upload' | 'media';
}

const STATIC_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in.',
  not_found: "We couldn't find that.",
  forbidden: "You can't change this item.",
  forbidden_origin: 'Request refused.',
  lead_only: 'Only the lead curator can schedule items.',
  idempotency_key_required: 'Missing idempotency key.',
  idempotency_conflict: 'This request key was already used for a different request.',
  payload_too_large: 'That request is too large.',
  unsupported_media_type: 'Send JSON.',
  validation_failed: 'Check the highlighted fields.',
  email_taken: 'An account with this email already exists.',
  invalid_credentials: 'Email or password is incorrect.',
  accounts_unavailable:
    "Accounts are unavailable right now. You can keep exploring, but your path won't be saved until they're back.",
  billing_unavailable: 'Payments are unavailable right now. You have not been charged. Please try again shortly.',
  card_declined: 'Your card was declined. You have not been charged.',
  booking_closed: 'Booking for this session has closed.',
  sold_out: 'Not enough seats left for this session.',
  already_member: "You're already a supporter. Change your plan instead.",
  change_pending: 'Undo your pending change before making another.',
  payment_overdue: 'Settle your overdue payment before changing your plan.',
  nothing_pending: "There's no pending change to undo.",
  nothing_due: "There's nothing to pay right now.",
  not_a_member: "You don't have a supporter membership.",
  not_editable: 'Only drafts can be edited.',
  session_not_cancellable: 'This session can no longer be cancelled.',
  fully_refunded: 'This order is already fully refunded.',
  price_change_conflict: 'A later price change is already scheduled.',
};

const STORAGE_MESSAGES = {
  purchase: "We can't issue tickets or receipts right now. You have not been charged. Please try again shortly.",
  upload: 'Media storage is unavailable right now. Your file was not uploaded.',
  media: 'This media is unavailable right now.',
} as const;

export function messageFor(code: ErrorCode, context: ErrorContext = {}): string {
  switch (code) {
    case 'currency_locked': {
      const currency = context.accountCurrency ?? 'EUR';
      return `Your supporter account pays in ${currency}. Choose ${currency} to continue.`;
    }
    case 'same_tier':
      return `You're already on the ${context.tierName ?? 'Reader'} tier.`;
    case 'illegal_transition':
      return `That move isn't allowed from ${context.statusLabel ?? 'Draft'}.`;
    case 'storage_unavailable':
      return STORAGE_MESSAGES[context.storageContext ?? 'media'];
    default:
      return STATIC_MESSAGES[code] ?? "We couldn't find that.";
  }
}

/* ------------------------------------------------------- commerce notices */

export function bookedNotice(seats: number, sessionTitle: string): string {
  return seats === 1 ? `Booked 1 seat for ${sessionTitle}.` : `Booked ${seats} seats for ${sessionTitle}.`;
}

export function bookingConfirmationLine(sessionTitle: string, displayTime: string, ticketCode: string): string {
  return `${sessionTitle}, ${displayTime}. Ticket ${ticketCode}.`;
}

export function donationNotice(amountMinor: number, currency: Currency): string {
  return `Donation of ${formatPrice(amountMinor, currency)} received.`;
}

export function joinNotice(tierName: TierName): string {
  return `Welcome, ${tierName} supporter.`;
}

export function upgradeNotice(tierName: TierName): string {
  return `You're now a ${tierName} supporter.`;
}

export function downgradeNotice(tierName: TierName, date: string): string {
  return `Your change to ${tierName} is pending until ${date}.`;
}

export function cancelEndOfTermNotice(date: string): string {
  return `Your membership ends on ${date}.`;
}

export const cancelOverdueNotice = 'Your membership has been cancelled.';
export const undoNotice = 'Your pending change was undone.';
export const retrySuccessNotice = 'Payment received. Your membership is active.';

export function movedNotice(statusLabel: StatusLabel): string {
  return `Moved to ${statusLabel}.`;
}

export function sessionCancelledNotice(refunds: number): string {
  return `Session cancelled. ${refunds} bookings refunded.`;
}

export function refundIssuedNotice(amountMinor: number, currency: Currency): string {
  return `Refund of ${formatPrice(amountMinor, currency)} issued.`;
}

export function refundCapError(remainingMinor: number, currency: Currency): string {
  return `Refund can't exceed ${formatPrice(remainingMinor, currency)}.`;
}

export function priceChangeNotice(date: string): string {
  return `New price scheduled from ${date}.`;
}

export function donationAmountError(minMinor: number, maxMinor: number, currency: Currency): string {
  return `Enter an amount between ${formatPrice(minMinor, currency)} and ${formatPrice(maxMinor, currency)}.`;
}

export function uploadPending(fileName: string): string {
  return `Uploading ${fileName}.`;
}

export function uploadComplete(fileName: string): string {
  return `Upload complete: ${fileName}.`;
}

/* ------------------------------------------------------- membership region */

export const MEMBERSHIP_STATUS_LABELS = {
  active: 'Active',
  pending_change: 'Pending change',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
} as const;

export function pendingDowngradeLine(tierName: TierName, date: string): string {
  return `Changes to ${tierName} on ${date}.`;
}

export function pendingCancellationLine(date: string): string {
  return `Ends on ${date}.`;
}

export function overdueLine(amountMinor: number, currency: Currency): string {
  return `Payment of ${formatPrice(amountMinor, currency)} is overdue.`;
}

export function nextChargeLine(amountMinor: number, currency: Currency, date: string): string {
  return `Next payment ${formatPrice(amountMinor, currency)} on ${date}.`;
}

export function planPriceLine(amountMinor: number, currency: Currency): string {
  return `${formatPrice(amountMinor, currency)} a month`;
}

export function bookingPriceLine(amountMinor: number, currency: Currency, seats: number): string {
  return `${formatPrice(amountMinor, currency)} for ${seats} seats`;
}

export function scheduledChangeLine(date: string, amountMinor: number, currency: Currency): string {
  return `From ${date}: ${formatPrice(amountMinor, currency)} a month`;
}

export const SESSION_STATUS_LABELS = {
  on_sale: 'On sale',
  closed: 'Closed',
  held: 'Held',
  cancelled: 'Cancelled',
} as const;

export function seatsLeftLine(seatsLeft: number): string {
  return seatsLeft === 1 ? '1 seat left' : `${seatsLeft} seats left`;
}

export function seatPriceLine(amountMinor: number, currency: Currency): string {
  return `${formatPrice(amountMinor, currency)} a seat`;
}

export function differenceCell(amountMinor: number, currency: Currency): string {
  return `Difference ${formatPrice(amountMinor, currency)}`;
}
