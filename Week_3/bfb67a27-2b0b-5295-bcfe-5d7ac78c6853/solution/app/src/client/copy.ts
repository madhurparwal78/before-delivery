import { formatMoney } from '../shared/money.js';

export const COPY = {
  noDatesHeading: 'Pick your shoot dates',
  noDatesText:
    "Set a pickup day and drag the return handle to see what's free and what it costs.",
  nothingFreeHeading: 'Nothing free for these dates',
  nothingFreeText:
    'Every kit is out or held on at least one of these days. Move the return handle or try another pickup day.',
  holdPending: 'Holding your units',
  heldHeading: 'Held for you',
  unitTakenHeading: 'This unit was just booked',
  unitTakenNoSerial: 'The last free unit was taken by another booking a moment ago.',
  holdEndedHeading: 'This hold has ended',
  holdEndedText: 'The units have been released. Pick dates again to make a new hold.',
  certificateUploading: 'Uploading certificate',
  certificateReceived: 'Certificate received. The owner will review it before you can confirm.',
  certificateUnderReview: 'Certificate under review',
  certificateApproved: 'Certificate approved',
  certificateNone: 'No certificate yet',
  confirmPending: 'Taking payment',
  confirmedHeading: "You're booked",
  cancelledHeading: 'Booking cancelled',
  photoUploading: 'Uploading photo',
  unitNotReady: 'Tick every check and attach a stored photo first',
  paymentsDownHeading: 'Payments are offline',
  paymentsDownText:
    "We can't take or refund payments right now, so bookings can't be confirmed, cancelled or closed. Holds keep running on their own timers.",
  storageDownHeading: 'Photo storage is offline',
  storageDownText:
    "Certificates and condition photos can't be saved right now. Anything already stored is safe.",
  ownerOnlyHeading: 'This page is for the owner',
  notFoundHeading: "We couldn't find that page",
} as const;

export function billableDaysLabel(count: number): string {
  return count === 1 ? '1 billable day' : `${count} billable days`;
}

export function hireTotalAnnouncement(hirePriceCents: number, billableDays: number): string {
  return `Hire total ${formatMoney(hirePriceCents)} for ${billableDaysLabel(billableDays)}`;
}

export function heldText(ref: string): string {
  return `Booking ${ref} is on hold. Upload your certificate and confirm before the hold ends.`;
}

export function confirmedText(ref: string, email: string): string {
  return `Booking ${ref} is confirmed. We've emailed your serial list to ${email}.`;
}

export function cancelledText(totalCents: number): string {
  return `We've refunded ${formatMoney(totalCents)} to your card.`;
}

export function unitTakenText(serial: string | null): string {
  return serial === null
    ? COPY.unitTakenNoSerial
    : `${serial} was taken by another booking a moment ago.`;
}

export function holdCountdown(secondsRemaining: number): string {
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `Hold ends in ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function depositLabel(
  status: 'none' | 'pending' | 'paid' | 'failed' | 'refunded',
): string {
  const labels = {
    none: 'Not taken',
    pending: 'Pending',
    paid: 'Paid',
    failed: 'Failed',
    refunded: 'Refunded',
  } as const;
  return `Deposit: ${labels[status]}`;
}

export function certificateRejected(reason: string): string {
  return `Certificate not accepted: ${reason}`;
}

export function repricedText(effectiveDate: string): string {
  return `Prices changed on ${effectiveDate}. Check the new total and confirm again.`;
}

export function freeForDatesLabel(free: number): string {
  return `${free} free for these dates`;
}

export function unknownSerialError(serial: string): string {
  return `${serial} is not on this booking`;
}

export const COUNTER_STATUS = {
  prepped: (ref: string): string => `Kit prepped · ${ref}`,
  swapped: (from: string, to: string): string => `Swapped ${from} for ${to}`,
  checkedOut: (ref: string): string => `Kit out · ${ref}`,
  unitCheckedIn: (serial: string): string => `${serial} checked in`,
  checkinClosed: (ref: string): string => `Check-in closed · ${ref}`,
} as const;

export const DESK_STATUS = {
  sentToRepair: (serial: string): string => `${serial} sent to repair`,
  backOnShelf: (serial: string): string => `${serial} back on the shelf`,
  rateCardPublished: (version: number, effectiveDate: string): string =>
    `Rate card v${version} published, effective ${effectiveDate}`,
  certificateApproved: (ref: string): string => `Certificate for ${ref} approved`,
  certificateRejected: (ref: string): string => `Certificate for ${ref} rejected`,
} as const;
