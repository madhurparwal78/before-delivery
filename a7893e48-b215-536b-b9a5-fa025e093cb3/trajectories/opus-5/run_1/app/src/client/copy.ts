import type { BookingStatus, SegmentState } from '../shared/types.js';

export function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function amount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function money(cents: number): string {
  return `$${amount(cents)}`;
}

export const STATE_WORD: Record<SegmentState, string> = {
  booked: 'Booked',
  held: 'Held',
  yours_booked: 'Your booking',
  yours_held: 'Your hold',
};

export const STATUS_STAMP: Record<BookingStatus, string> = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  overrun_billed: 'Overrun billed',
  checked_out: 'Checked out',
  settled: 'Settled',
  cancelled_refunded: 'Cancelled — refunded',
  cancelled_forfeit: 'Cancelled — forfeited',
  unpaid_cancelled: 'Cancelled — unpaid',
};

export function termsLine(noticeHours: number): string {
  return `Free cancellation until ${noticeHours} hours before start. Later cancellations keep the time charge and the deposit.`;
}

export const copy = {
  signingIn: 'Signing in…',
  signInWrong: 'Email or password is wrong.',
  placingHold: 'Placing hold…',
  holdPlaced: (until: string) => `Held until ${until}. Finish checkout to keep it.`,
  slotTaken: (label: string) => `Another renter just took this time. ${label}`,
  holdInvalid: (message: string) => `That time can't be held: ${message}`,
  dragBlocked: (label: string) => `Stopped at ${label}`,
  holdExpiredNotice: 'Your hold ran out and the time was released.',
  releasing: 'Releasing…',
  released: 'Hold released.',
  confirming: 'Confirming…',
  confirmed: 'Booking confirmed. Confirmation email queued.',
  confirmGone: 'Your hold ran out before payment. Nothing was charged.',
  certificateRequired: (dates: readonly string[]) =>
    `Upload a liability certificate that covers ${dates.join(', ')} before confirming.`,
  payNowRequired: 'This booking starts too soon to pay later. Choose Pay now.',
  packInsufficient: 'Your pack no longer covers these hours. Untick Use pack hours or buy a pack.',
  billingDelayedConfirm: 'Card payments are delayed while billing is unreachable. Nothing was charged.',
  paying: 'Paying…',
  paid: (cents: number) => `Balance paid: ${money(cents)}.`,
  buyingPack: 'Buying pack…',
  packBought: (availableMinutes: number) => `20 hours added. ${hours(availableMinutes)} h available.`,
  cancelling: 'Cancelling…',
  cancelledFull: (cardCents: number, packMinutes: number, depositCents: number) =>
    `Cancelled. Refunded ${money(cardCents)} to card, ${hours(packMinutes)} h to your pack and the ${money(depositCents)} deposit.`,
  cancelledForfeit: (noticeHours: number) =>
    `Cancelled under your booking's ${noticeHours}-hour terms. Nothing was refunded.`,
  cancelBillingDelayed: 'Refunds are delayed while billing is unreachable. Your booking is unchanged.',
  cancelAhead: "You'll get a full refund.",
  cancelInside: (noticeHours: number) =>
    `You're inside the ${noticeHours}-hour notice. Nothing will be refunded.`,
  saving: 'Saving…',
  checkedIn: (business: string) => `Checked in: ${business}.`,
  checkedOut: (business: string) => `Checked out: ${business}.`,
  outsideCheckInWindow: 'Check-in opens 30 minutes before start.',
  charging: 'Charging…',
  overrunCharged: (minutes: number, cents: number) =>
    `Overrun of ${minutes} min charged: ${money(cents)}.`,
  overrunBillingDelayed:
    'Overrun can\u2019t be charged while billing is unreachable. Nothing was charged.',
  cleaningCharged: (cents: number) => `Cleaning fee charged: ${money(cents)}.`,
  cleaningBillingDelayed:
    'Cleaning fee can\u2019t be charged while billing is unreachable. Nothing was charged.',
  settling: 'Settling…',
  settled: (cents: number) => (cents > 0 ? `Settled. Deposit refunded: ${money(cents)}.` : 'Settled.'),
  settleBillingDelayed: 'Settlement is delayed while billing is unreachable. The booking is unchanged.',
  uploading: 'Uploading…',
  documentSaved: 'Document saved.',
  unsupportedFile: 'Files must be PDF, PNG or JPEG.',
  fileTooLarge: 'Files must be 5,000,000 bytes or smaller.',
  scheduling: 'Scheduling…',
  policyScheduled: (noticeHours: number, date: string) =>
    `${noticeHours}-hour policy scheduled from ${date}.`,
  policyDateTaken: 'A policy already starts on that date.',
  binderReady: 'Binder link ready.',
  binderRegenerated: 'New link ready. The old link no longer works.',
  binderRevoked: 'Link revoked.',
  overrideCancelling: 'Cancelling…',
  overrideCancelled: 'Cancelled with full refund. Reason recorded.',
  overrideReasonShort: 'Give a reason of at least 5 characters.',
  billingBanner: 'Card payments are delayed: billing is unreachable. Pack bookings still work.',
  mailBanner: 'Emails are delayed and will send automatically when mail is back.',
  chooseRenter: 'Choose a renter before claiming time.',
  noSelection: 'No selection',
};
