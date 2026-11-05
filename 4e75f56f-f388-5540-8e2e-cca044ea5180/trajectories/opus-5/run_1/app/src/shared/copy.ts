import { formatDollars } from './money.js';

export const HANDS_ON_FIELD_ERROR = 'Hands-on time must stay at least 30% of the agenda.';

export const DEPOSITS_CLOSED_LINE =
  'Deposits closed on 19 March 2027. Pay in full to reserve a bench.';

export const ATELIER_SOLD_OUT_HEADING = 'Atelier is sold out';
export const ATELIER_SOLD_OUT_BANNER =
  'All 10 Atelier places are taken. Join the Atelier waitlist and we will offer you the next Atelier bench that opens.';

export const BILLING_OFFLINE =
  'Billing is offline right now. Your hold keeps running and no money has moved.';
export const DESK_BILLING_BANNER =
  'Kill Bill is not answering. Paid and refunded totals will refresh when it is back.';

export const NO_WEBGL_LINE = 'The 3D lab needs WebGL. Here is the flat bench plan.';
export const CONTENT_UNAVAILABLE_LINE = 'The programme is loading slowly. Refresh in a moment.';
export const NOT_FOUND_HEADING = 'This page is not on the programme';
export const SIGN_IN_FAILED = 'Email or password is incorrect.';
export const CHECKING_HOLD = 'Checking your hold';
export const PROCESSING_PAYMENT = 'Processing payment';
export const CONTENT_SAVED = 'Saved. The public site shows it on the next load.';
export const REFUNDS_CLOSED =
  'Refunds closed on 19 March 2027. You can assign this seat to a colleague instead.';

export const UPLOAD_WRONG_TYPE = 'Upload a PDF, JPEG or PNG file.';
export const UPLOAD_TOO_LARGE = 'Files must be 10,000,000 bytes or smaller.';
export const UPLOAD_STORAGE_OFFLINE =
  'Uploads are unavailable right now. Nothing was saved; try again shortly.';
export const DOCUMENT_STORAGE_OFFLINE = 'Documents are unavailable right now. Try again shortly.';

const seats = (remaining: number): string => `${remaining} of 24 seats remaining.`;

export const benchUpdates = {
  pendingHold: (bench: string): string => `Holding Bench ${bench}`,
  pendingGroupHold: (count: number): string => `Holding ${count} benches`,
  holdPlaced: (bench: string, remaining: number): string =>
    `Bench ${bench} is held for you. ${seats(remaining)}`,
  groupHoldPlaced: (count: number, remaining: number): string =>
    `${count} benches are held for you. ${seats(remaining)}`,
  benchTaken: (bench: string, remaining: number): string =>
    `Bench ${bench} was just taken. ${seats(remaining)}`,
  atelierSoldOut: (remaining: number): string => `Atelier is sold out. ${seats(remaining)}`,
  atelierOnly: (bench: string): string =>
    `Bench ${bench} is an Atelier bench. Switch to Atelier to hold it.`,
  released: (bench: string, remaining: number): string =>
    `Bench ${bench} released. ${seats(remaining)}`,
  holdEnded: (bench: string, remaining: number): string =>
    `Your hold on Bench ${bench} has ended. ${seats(remaining)}`,
  paid: (bench: string, remaining: number): string => `Bench ${bench} is yours. ${seats(remaining)}`,
  groupPaid: (count: number, remaining: number): string =>
    `${count} benches are yours. ${seats(remaining)}`,
  paymentPending: (bench: string): string =>
    `Payment for Bench ${bench} is being confirmed. We will update this page and email your receipt.`,
  groupPaymentPending: (count: number): string =>
    `Payment for ${count} benches is being confirmed. We will update this page and email your receipt.`,
  waitlistJoined: (tier: string, position: number): string =>
    `You are number ${position} on the ${tier} waitlist.`,
};

export const confirmationHeading = (bench: string): string => `Bench ${bench} is yours`;
export const groupConfirmationHeading = (count: number): string =>
  `Group invoice confirmed: ${count} seats on one invoice`;

export const holdEndedDialog = {
  heading: 'Your hold has ended',
  body: (bench: string): string =>
    `Bench ${bench} is back on the map. Pick another bench or join the waitlist.`,
};

export const offerRegion = {
  heading: (bench: string): string => `Bench ${bench} is waiting for you`,
  left: (secondsRemaining: number): string => {
    const total = Math.max(0, secondsRemaining);
    const hours = Math.floor(total / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((total % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(total % 60)
      .toString()
      .padStart(2, '0');
    return `${hours}:${minutes}:${seconds} left to accept`;
  },
};

export const accountUpdates = {
  balancePaid: (bench: string): string => `Bench ${bench} is paid in full.`,
  upgraded: (bench: string): string => `Bench ${bench} is now your Atelier bench.`,
  cancelled: (bench: string, refundCents: number): string =>
    `Bench ${bench} is cancelled. Refund due: $${formatDollars(refundCents)}. The registrar will send it.`,
  assigned: (bench: string, name: string): string =>
    `Bench ${bench} is assigned to ${name}. We emailed them.`,
  seatAccepted: (bench: string): string => `Bench ${bench} is now your seat.`,
  licenceUploaded: 'Licence received. The registrar will check it.',
  passportUploaded: 'Passport scan received. The registrar will prepare your letter.',
  offerLapsed: 'This offer has passed to the next person on the waitlist.',
};

export const deskUpdates = {
  refundSent: (amountCents: number, bench: string): string =>
    `Refunded $${formatDollars(amountCents)} for Bench ${bench}.`,
  refundBlocked: 'Refund not sent: Kill Bill is not answering. Nothing was refunded.',
  licenceMatched: (name: string): string => `Licence matched for ${name}.`,
  licenceRejected: (name: string): string => `Licence rejected for ${name}.`,
  visaIssued: (name: string): string => `Visa-support letter issued to ${name}.`,
  visaBlocked: 'Visa letter not issued: document storage is not answering. Nothing was sent.',
  certificateIssued: (name: string): string => `Certificate issued to ${name}.`,
  certificateBlocked:
    'Certificate not issued: document storage is not answering. No certificate number was used.',
  certificateNotReady: (missing: string): string => `Certificate not ready: ${missing}.`,
};

const MISSING_WORDS: Record<string, string> = {
  balance_unpaid: 'balance unpaid',
  day1_check_in: 'day 1 check-in',
  day2_check_in: 'day 2 check-in',
  licence_not_matched: 'licence not matched',
};

export const missingWords = (missing: readonly string[]): string =>
  missing.map((gap) => MISSING_WORDS[gap] ?? gap).join(', ');

export const handsOnShareText = (handsOn: number, total: number, percent: string): string =>
  `Hands-on ${handsOn} of ${total} minutes (${percent}%)`;

export const checkinCopy = {
  dayHeading: (openDay: 1 | 2 | null): string =>
    openDay === null ? 'Check-in is closed today' : `Day ${openDay} check-in`,
  matches: (count: number, query: string): string => `Found ${count} for "${query}".`,
  noMatches: (query: string): string => `No attendee matches "${query}".`,
  checkedIn: (name: string, day: number): string => `${name} checked in for day ${day}.`,
  alreadyCheckedIn: (name: string, day: number): string =>
    `${name} is already checked in for day ${day}.`,
  balanceDue: (name: string): string => `${name} has a balance due. Send them to the registrar.`,
  noDay1: (name: string): string => `${name} has no day 1 check-in. Send them to the registrar.`,
  noAttendee: 'This seat has no attendee yet. Send them to the registrar.',
};
