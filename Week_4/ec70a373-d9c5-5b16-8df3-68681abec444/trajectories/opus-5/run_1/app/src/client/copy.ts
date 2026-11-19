/** Every published copy string and format, rendered character for character. */

export function hours(value: number): string {
  return value.toFixed(2);
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction
    .toString()
    .padStart(2, '0')}`;
}

export function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function countdownMinutes(remainingMs: number): string {
  return String(Math.max(0, Math.ceil(remainingMs / 60000)));
}

export function lateMinutes(remainingMs: number): string {
  return String(Math.max(0, Math.floor(remainingMs / 60000)));
}

export function retryMinutes(retryAfterSeconds: number): string {
  return String(Math.max(1, Math.ceil(retryAfterSeconds / 60)));
}

export const COPY = {
  internal: 'Something went wrong. Refresh to see the current state.',
  offline: "Can't reach Pilotlight. Check your connection and try again.",
  csrf: 'Your session changed in another tab. Refresh and try again.',
  ticketChanged: 'This booking changed elsewhere. Its ticket now shows the current state.',
  rowChanged: 'This booking changed elsewhere. Its row now shows the current state.',
  sessionEnded: 'Your session has ended. Sign in again.',
  signingIn: 'Signing in…',
  signInInvalid: "That email and password don't match.",
  signInThrottled: (seconds: number): string =>
    `Too many sign-in attempts. Try again in ${retryMinutes(seconds)} minutes.`,
  signInEmail: 'Enter a valid email address.',
  signInPassword: 'Enter your password.',

  holding: (start: string, end: string): string => `Holding ${start}–${end}…`,
  held: (station: string, start: string, end: string, expiry: string): string =>
    `Held ${station} ${start}–${end}. Confirm before ${expiry} site time.`,
  slotTaken: 'Someone else just claimed that window. Your pack hours are unchanged.',
  certificateExpired: (date: string): string =>
    `Your certificate of insurance doesn't cover ${date}. Upload a current one to book.`,
  cutoff: 'That date is closed for booking. Bookings for tomorrow close at 18:00 site time.',
  holdLimit: 'You already hold 3 windows. Confirm or release one first.',
  insufficientHours: 'Not enough pack hours for this window. Buy a pack to continue.',
  holdInProgress: 'Your hold is still being placed. Wait a moment.',
  holdKeyConflict: 'That hold request was already used for another window. Drag the window again.',
  windowInvalid: "That window isn't valid. Pick quarter-hour times within one day.",

  confirming: 'Confirming…',
  confirmed: (station: string, date: string, start: string, end: string, left: number): string =>
    `Confirmed ${station} ${date} ${start}–${end}. ${hours(left)} pack hours left.`,
  holdExpired: 'Your hold expired and the window was released.',
  releasing: 'Releasing…',
  released: (left: number): string => `Hold released. ${hours(left)} pack hours returned.`,

  cancelling: 'Cancelling…',
  cancelledFullRefund: (refunded: number): string =>
    `Booking cancelled. ${hours(refunded)} pack hours refunded.`,
  cancelledSplit: (refunded: number, forfeited: number): string =>
    `Booking cancelled. ${hours(refunded)} pack hours refunded, ${hours(forfeited)} forfeited.`,
  cancelledFullForfeit: (forfeited: number): string =>
    `Booking cancelled. ${hours(forfeited)} pack hours forfeited.`,

  managerCancelledFullRefund: (reference: string, business: string, refunded: number): string =>
    `Cancelled ${reference} for ${business}. ${hours(refunded)} pack hours refunded.`,
  managerCancelledSplit: (
    reference: string,
    business: string,
    refunded: number,
    forfeited: number,
  ): string =>
    `Cancelled ${reference} for ${business}. ${hours(refunded)} pack hours refunded, ${hours(
      forfeited,
    )} forfeited.`,
  managerCancelledFullForfeit: (
    reference: string,
    business: string,
    forfeited: number,
  ): string =>
    `Cancelled ${reference} for ${business}. ${hours(forfeited)} pack hours forfeited.`,
  reasonRequired: 'Give a reason the member can act on.',

  outcomeFullRefund: (refunded: number): string =>
    `Cancelling refunds ${hours(refunded)} pack hours.`,
  outcomeSplitLead: (refunded: number): string =>
    `Cancelling now refunds ${hours(refunded)} pack hours and forfeits `,
  outcomeSplitTail: (forfeited: number): string => `${hours(forfeited)} pack hours.`,
  outcomeFullForfeit: (forfeited: number): string =>
    `Cancelling now forfeits ${hours(forfeited)} pack hours.`,

  bookingSeries: (weeks: number): string => `Booking ${weeks} weeks…`,
  seriesBooked: (weeks: number, left: number): string =>
    `Booked ${weeks} weekly slots. ${hours(left)} pack hours left.`,
  seriesConflict: (dates: string[]): string =>
    `Some weeks are taken: ${dates.join(', ')}. Nothing was booked.`,
  seriesCertificate: (dates: string[]): string =>
    `Your insurance doesn't cover: ${dates.join(', ')}. Nothing was booked.`,
  seriesUses: (used: number): string => `Uses ${hours(used)} pack hours`,
  seriesAfter: (left: number): string => `Pack hours after this series ${hours(left)}`,
  seriesNotEnough: (weeks: number): string => `Not enough pack hours for ${weeks} weeks.`,

  charging: (price: number): string => `Charging $${money(price)}…`,
  packAdded: (added: number, validThrough: string, email: string): string =>
    `Added ${hours(added)} pack hours, valid through ${validThrough}. A receipt is on its way to ${email}.`,
  billingUnavailablePack:
    'Billing is unreachable right now. You have not been charged and no hours were added.',
  packInProgress: 'Your payment is still being processed. Wait a moment.',
  packKeyConflict: 'This purchase was already used for a different pack. Close the dialog and try again.',

  uploading: 'Uploading…',
  uploaded: (label: string): string => `Uploaded ${label}. It is waiting for review.`,
  unsupportedType: 'Upload a PDF, PNG or JPEG file.',
  fileTooLarge: 'Files can be at most 5,000,000 bytes.',
  coverageTooLow: 'Coverage must be at least $1,000,000 per occurrence.',
  additionalInsured: (legalName: string): string =>
    `The certificate must name ${legalName} as additional insured.`,
  expiryDateRequired: 'Enter the expiry date shown on the document.',
  fileRequired: 'Choose a file to upload.',
  storageUnavailableUpload:
    'Document storage is unreachable. Nothing was uploaded; try again shortly.',
  storageUnavailableOpen: "This file can't be opened right now. Try again shortly.",

  saving: 'Saving…',
  verified: (business: string, validThrough: string): string =>
    `Verified. ${business} is covered through ${validThrough}.`,
  alreadyReviewed: 'This document was already reviewed.',
  documentExpired: "This document's expiry date has passed. Reject it instead.",
  rejected: (label: string, business: string): string => `Rejected ${label} for ${business}.`,

  checkingIn: 'Checking in…',
  checkedIn: (business: string, station: string): string =>
    `Checked in ${business} on ${station}.`,
  tooEarlyCheckIn: 'Too early to check in. Check-in opens 15 minutes before the start.',
  tooLateCheckIn: 'This booking has ended and can no longer be checked in.',
  certificateExpiredManager: (business: string): string =>
    `${business}'s certificate of insurance has expired. They can't use the kitchen until a current one is verified.`,
  noShowMarked: (business: string, forfeited: number): string =>
    `Marked ${business} as a no-show. ${hours(forfeited)} pack hours forfeited.`,
  tooEarlyNoShow: (time: string): string =>
    `A no-show can be marked from ${time}, 30 minutes after the start.`,
  checkingOut: 'Checking out…',
  checkedOutLate: (
    business: string,
    lateHours: number,
    packHours: number,
    total: number,
  ): string =>
    `Checked out ${business}. Late ${hours(lateHours)} h; ${hours(
      packHours,
    )} pack hours applied; overage $${money(total)}.`,
  checkedOutOnTime: (business: string): string => `Checked out ${business} on time.`,
  billingUnavailableCheckOut:
    'Billing is unreachable, so this check-out was not recorded. Try again in a moment.',
  checkOutInProgress: 'This check-out is still being processed. Wait a moment.',
  checkOutKeyConflict:
    'This check-out request was already used for another booking. Close the dialog and try again.',

  truckArrived: (time: string): string => `Truck arrived at ${time}.`,
  visitOpen: 'This truck is already checked in. Record its departure first.',
  departureRecorded: (time: string): string => `Departure recorded at ${time}.`,
  servicesRequired: 'Choose at least one service.',
  signatureRequired: "Type the operator's name to sign.",
  departureAlready: 'This visit already has a departure.',
  issuingLink: 'Issuing link…',
  linkSent: (email: string, date: string, time: string): string =>
    `Link sent to ${email}. It works until ${date} ${time} site time.`,
  inspectorEmailInvalid: 'Enter a valid email address.',
  storageUnavailableLink: 'Document storage is unreachable, so no link was issued.',
  revoking: 'Revoking…',
  linkRevoked: 'Link revoked. It stops working now.',
  linkNotLive: 'This link is no longer live.',
  reissuing: 'Reissuing…',
  linkReissued: (email: string): string => `New link sent to ${email}. The old link no longer works.`,

  rateScheduled: (date: string): string => `Rate scheduled from ${date}.`,
  effectiveFromInvalid: 'The effective date must be after today in site time.',
  hourlyRateInvalid: 'Enter an hourly rate between $0.01 and $1,000.00.',
  taxRateInvalid: 'Enter a tax rate between 0 and 25 percent with up to three decimals.',
  rateExists: (date: string): string => `A rate already starts on ${date}.`,

  loadingReport: 'Loading report…',
  showingMonth: (month: string): string => `Showing ${month}.`,
  monthInvalid: 'Enter a month as YYYY-MM.',
  memberNotInTenant: "That member isn't in your incubator.",
  pdfUnavailable: "The PDF can't be downloaded right now. The table above is current.",
} as const;

export const STATUS_WORDS: Record<string, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const TYPE_LABELS: Record<string, string> = {
  certificate_of_insurance: 'Certificate of insurance',
  food_handler_certificate: 'Food handler certificate',
  business_licence: 'Business licence',
};

export const SERVICE_LABELS: Record<string, string> = {
  potable_water: 'Potable water',
  grey_water: 'Grey water',
  grease: 'Grease',
  food_storage: 'Food storage',
  cleaning: 'Cleaning',
  restock: 'Restock',
};

export const MOVEMENT_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  pack_purchase: 'Pack purchase',
  booking_debit: 'Booking',
  hold_release: 'Hold released',
  cancel_refund: 'Cancellation refund',
  forfeit: 'Forfeit',
  usage: 'Station time used',
  late_checkout: 'Late check-out',
  pack_expiry: 'Pack hours expired',
};

export const STATION_TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'oven', label: 'Ovens' },
  { value: 'mixer', label: 'Mixers' },
  { value: 'blast_chiller', label: 'Blast chillers' },
  { value: 'prep_table', label: 'Prep tables' },
] as const;
