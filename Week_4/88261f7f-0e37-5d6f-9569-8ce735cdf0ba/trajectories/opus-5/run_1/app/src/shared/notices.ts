import { formatMoney } from './money';
import { PlainDate } from './dates';

/** The published notice texts. Built here so a screen and a pushed change always read alike. */
export const notices = {
  stayCreated: (guest: string, roomNumber: string): string =>
    `Stay created for ${guest} in room ${roomNumber}.`,
  stayUpdated: (guest: string): string => `Stay updated for ${guest}.`,
  pickedUp: (guest: string): string => `Picked up ${guest}.`,
  overCell: (roomNumber: string, date: PlainDate): string => `Over room ${roomNumber}, ${date}.`,
  moved: (guest: string, roomNumber: string): string => `Moved ${guest} to room ${roomNumber}.`,
  moveCancelled: 'Move cancelled.',
  checkedIn: (guest: string, roomNumber: string): string =>
    `Checked in ${guest} to room ${roomNumber}.`,
  checkedOut: (guest: string, roomNumber: string): string =>
    `Checked out ${guest} from room ${roomNumber}.`,
  cancelled: (guest: string, feeCents: number): string =>
    feeCents === 0
      ? `Cancelled ${guest}'s stay. No fee.`
      : `Cancelled ${guest}'s stay. Fee: ${formatMoney(feeCents)}.`,
  linkSent: (guest: string): string => `Check-in link sent to ${guest}.`,
  roomStatus: (roomNumber: string, status: string): string =>
    `Room ${roomNumber} is now ${status}.`,
  onlineCheckInCompleted: (roomNumber: string): string =>
    `Room ${roomNumber} guest completed online check-in.`,
  guestsMerged: (staysMoved: number): string => `Guests merged. ${staysMoved} stays moved.`,
  noStayHere: 'No stay here.',
  closeDone: (businessDate: PlainDate, roomsCharged: number, noShows: number): string =>
    `Business date ${businessDate} closed. ${roomsCharged} rooms charged. ${noShows} no-shows.`,
  chargeAdded: (amountCents: number): string => `Charge of ${formatMoney(amountCents)} added.`,
  paymentRecorded: (amountCents: number): string =>
    `Payment of ${formatMoney(amountCents)} recorded.`,
  reversalPosted: 'Reversal posted.',
  splitDone: (amountCents: number, folioCount: number): string =>
    `Split ${formatMoney(amountCents)} across ${folioCount} folios.`,
  entryMoved: (folioLetter: string): string => `Entry moved to Folio ${folioLetter}.`,
  payerSaved: 'Payer saved.',
  invoiceIssued: (number: string): string => `Invoice ${number} issued.`,
  invoiceSent: (number: string, email: string): string => `Invoice ${number} sent to ${email}.`,
  ratesSaved: 'Rates saved.',
  photoReceived: 'Received',
  checkInComplete: (arrival: PlainDate): string => `Check-in complete. See you on ${arrival}.`,
  freeRooms: (count: number): string => `${count} rooms free tonight`,
} as const;

export const pendingTexts = {
  signIn: 'Signing in…',
  createStay: 'Creating stay…',
  saveStay: 'Saving stay…',
  moveStay: 'Moving stay…',
  checkIn: 'Checking in…',
  checkOut: 'Checking out…',
  cancelStay: 'Cancelling stay…',
  resendLink: 'Sending check-in link…',
  roomStatus: 'Saving status…',
  merge: 'Merging guests…',
  runClose: 'Running close…',
  addCharge: 'Saving charge…',
  recordPayment: 'Saving payment…',
  reverse: 'Posting reversal…',
  split: 'Splitting charge…',
  moveEntry: 'Moving entry…',
  savePayer: 'Saving payer…',
  closeFolio: 'Creating invoice…',
  emailInvoice: 'Sending invoice…',
  saveRates: 'Saving rates…',
  uploadPhoto: 'Uploading photo…',
  completeCheckIn: 'Completing check-in…',
} as const;

export const pageNotFoundText = 'Page not found.';
export const deadLinkText = 'This check-in link is no longer valid.';
