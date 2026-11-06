/**
 * Every published string, word for word. Straight apostrophes, an en dash in
 * time ranges, one ellipsis character and the real minus sign.
 */

import { EN_DASH, MINUS } from './format.js';
import type { ComplianceState, DocumentKind } from './types.js';

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  coi: 'certificate of insurance',
  food_handler_card: 'food-handler card',
  business_licence: 'business licence',
};

export const PRODUCT_NAME = 'Railside';
export const BRAND_NAME = 'Brigade & Bench';

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export const EMPTY_BOARD = 'No bookings on this day.';
export const EMPTY_LEDGER = 'No hour movements yet.';
export const EMPTY_STATEMENTS = 'No statements yet.';
export const EMPTY_LINKS = 'No compliance links yet.';
export const EMPTY_USAGE_SHEET = 'No bookings on this day.';
export const EMPTY_SHARE = 'No current documents to show.';

export const SIGN_IN_PENDING = 'Signing in…';
export const SIGN_IN_MISMATCH = "That email and password don't match.";

export const APPLY_PENDING = 'Sending application…';
export const APPLY_SUCCESS =
  'Application received. Upload your three documents to move to review.';
export const EMAIL_TAKEN = 'That email already has an account.';

export const PURCHASE_PENDING = 'Processing purchase…';
export const PURCHASE_UNAVAILABLE =
  'Pack purchases are unavailable right now. You can still book with the hours you already own.';
export const PURCHASE_DECLINED = "The payment didn't go through. No hours were added.";
export const PURCHASE_AVAILABLE_AGAIN = 'Pack purchases are available again.';
export const purchasePaid = (hours: string): string =>
  `Paid. ${hours} hours added to your balance. Your receipt is on its way.`;

export const UPLOAD_PENDING = 'Uploading…';
export const UPLOAD_TOO_LARGE = 'That file is larger than 5,000,000 bytes.';
export const UPLOAD_WRONG_TYPE = 'Upload a PDF, PNG or JPEG scan.';
export const STORAGE_UNREACHABLE = 'File storage is unreachable. Try the upload again in a minute.';
export const uploadSuccess = (label: string): string => `${label} uploaded. It's waiting for review.`;

export const sweepStep = (
  station: string,
  start: string,
  end: string,
  hours: string,
  bufferEnd: string,
): string => `${station}, ${start} to ${end}, ${hours} hours, buffer until ${bufferEnd}.`;

export const SWEEP_TAKEN = 'That time is taken.';

export type StopReason =
  | { kind: 'booking'; at: string }
  | { kind: 'buffer'; until: string }
  | { kind: 'maintenance'; at: string }
  | { kind: 'max_length' }
  | { kind: 'day_end' }
  | { kind: 'balance'; hours: string };

export function stopReasonText(reason: StopReason): string {
  switch (reason.kind) {
    case 'booking':
      return `another booking starts at ${reason.at}`;
    case 'buffer':
      return `another booking's buffer runs until ${reason.until}`;
    case 'maintenance':
      return `maintenance starts at ${reason.at}`;
    case 'max_length':
      return 'six hours is the longest booking';
    case 'day_end':
      return 'the kitchen day ends at 24:00';
    case 'balance':
      return `your balance covers ${reason.hours} hours`;
  }
}

export const sweepStop = (end: string, reason: StopReason): string =>
  `Can't extend past ${end}: ${stopReasonText(reason)}.`;

export const HOLD_PENDING = 'Placing hold…';
export const holdPlaced = (station: string, start: string, end: string): string =>
  `Hold placed on ${station} ${start} to ${end}. Confirm before the countdown ends.`;
export const lostClaimShrunk = (legalEnd: string): string =>
  `Another renter claimed this time first. Your ticket now ends at ${legalEnd}.`;
export const LOST_CLAIM_REMOVED =
  'Another renter claimed this time first. Your ticket was removed.';
export const shortOfHours = (needed: string, balance: string): string =>
  `You need ${needed} hours and have ${balance}. Buy a pack to continue.`;
export const COMPLIANCE_LAPSED =
  'Bookings are paused until your certificate of insurance and food-handler card are current.';
export const RENTER_NOT_ACTIVE = "Your account isn't active yet.";

export const CONFIRM_PENDING = 'Confirming…';
export const CONFIRM_SUCCESS = 'Booking confirmed. A confirmation email is on its way.';
export const HOLD_RAN_OUT = 'This hold ran out and the time was released.';

export const RELEASE_PENDING = 'Releasing…';
export const releaseSuccess = (hours: string): string =>
  `Hold released. ${hours} hours returned to your balance.`;

export const CANCEL_PENDING = 'Cancelling…';
export const cancelCredited = (hours: string): string =>
  `Booking cancelled. ${hours} hours returned to your balance.`;
export const cancelForfeited = (hours: string): string =>
  `Booking cancelled. ${hours} hours were forfeited because it was within 48 hours of the start.`;
export const cancelOutcomeReturns = (hours: string): string =>
  `Cancelling now returns ${hours} hours.`;
export const cancelOutcomeForfeits = (hours: string): string =>
  `Cancelling now forfeits ${hours} hours.`;

export const displacedCopy = (
  station: string,
  start: string,
  end: string,
  hours: string,
): string =>
  `Your booking on ${station} ${start}${EN_DASH}${end} was displaced by maintenance. ${hours} hours returned to your balance.`;
export const NO_LONGER_ACTIVE = 'This booking is no longer active.';

export const SAVING = 'Saving…';
export const checkedIn = (hhmm: string): string => `Checked in at ${hhmm}.`;
export const checkedOutWithOverage = (units: number, usd: string): string =>
  `Checked out. Overage: ${units} \u00d7 15 minutes, $${usd}.`;
export const CHECKED_OUT_NO_OVERAGE = 'Checked out. No overage.';
export const CHECKOUT_BILLING_DOWN =
  "Billing is unreachable, so this check-out wasn't recorded. Try again in a minute.";

export const stationBlocked = (displaced: number): string =>
  `Station blocked. ${displaced} bookings displaced. Affected renters are being emailed.`;
export const STATION_IN_USE = 'Someone is checked in on that station during that time.';

export const documentApproved = (label: string): string => `${label} approved.`;
export const documentRejected = (label: string): string => `${label} rejected.`;
export const RENTER_ACTIVATED = 'Renter activated.';
export const RENTER_OFFBOARDED = 'Renter offboarded.';
export const ADJUSTMENT_RECORDED = 'Adjustment recorded.';
export const settingsSaved = (date: string): string =>
  `Settings saved. They apply to bookings created from ${date}.`;
export const DOCUMENTS_INCOMPLETE = 'Every document must be approved and current first.';
export const DOCUMENT_ALREADY_EXPIRED = 'That document has already expired.';

export const shelfStarted = (business: string): string =>
  `Shelf subscription started for ${business}.`;
export const shelfEnded = (business: string): string =>
  `Shelf subscription ended for ${business}.`;
export const BILLING_UNREACHABLE = 'Billing is unreachable. Try again in a minute.';
export const SHELF_RENTER_NOT_ACTIVE =
  'That renter must be active to start a shelf subscription.';

export const linkCreated = (dateTime: string): string => `Link created. It works until ${dateTime}.`;
export const LINK_REVOKED = 'Link revoked.';
export const LINK_REGENERATED = 'New link created. The old link no longer works.';

export const STATEMENT_PENDING = 'Creating statement…';
export const statementReady = (month: string): string => `Statement for ${month} is ready.`;

export const SHARE_DEAD_HEADING = 'This link is no longer active';
export const SHARE_DEAD_BODY = 'Ask the kitchen operator for a new link.';

export const COPIED = 'Copied';

export const complianceLine = (state: ComplianceState, expiresOn: string | null): string => {
  switch (state) {
    case 'current':
      return 'Compliance: current';
    case 'expiring':
      return `Compliance: expires ${expiresOn ?? ''}`;
    case 'lapsed':
      return 'Compliance: lapsed';
    case 'incomplete':
      return 'Compliance: incomplete';
  }
};

export const DOCUMENT_WORD_PENDING = 'Waiting for review';
export const DOCUMENT_WORD_APPROVED = 'Approved';
export const DOCUMENT_WORD_REJECTED = 'Rejected';
export const DOCUMENT_WORD_EXPIRED = 'Expired';

export const RENTER_WORDS: Record<string, string> = {
  applied: 'Applied',
  documents_review: 'In review',
  active: 'Active',
  suspended: 'Suspended',
  offboarded: 'Offboarded',
};

export const USAGE_ROW_WORDS: Record<string, string> = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
};

export const pendingDebit = (hours: string): string => `Pending ${MINUS}${hours} h`;

export const timeDoesNotExist = (date: string): string =>
  `That time does not exist on ${date} in the kitchen's time zone.`;

export const liveHoldLine = (
  station: string,
  date: string,
  start: string,
  end: string,
): string => `Hold ${station} ${date} ${start}${EN_DASH}${end}`;

export const minutesLeft = (minutes: number): string => `${minutes} min left`;
