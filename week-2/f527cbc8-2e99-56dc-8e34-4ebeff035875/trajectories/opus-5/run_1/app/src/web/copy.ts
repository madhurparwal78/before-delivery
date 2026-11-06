/** Every published line of feedback copy, in one place. */

export const copy = {
  signingIn: 'Signing in…',
  signInWrong: 'Email or password is wrong.',

  holdingSlot: 'Holding slot…',
  dayFull: 'This barn day is full. You can join the waitlist.',
  slotTaken: 'That slot was just taken. Pick another time.',
  notOpenForBooking: 'This barn day is not taking bookings.',
  horseAlreadyBooked: (horse: string) => `${horse} already has a booking on this day.`,
  cardDeclinedHold: 'Your card was declined. No slot was held.',
  accountBlocked: 'Your account has an unpaid invoice. Pay it to book again.',

  confirmingBooking: 'Confirming booking…',
  booked: (horse: string, time: string, date: string) =>
    `Booked ${horse} for ${time} on ${date}. A confirmation email is on its way.`,
  holdExpired: (time: string) => `Your hold on ${time} ran out. Pick a time again.`,

  releasingHold: 'Releasing hold…',
  holdReleased: 'Hold released.',

  joiningWaitlist: 'Joining waitlist…',
  onWaitlist: (horse: string, position: number) => `${horse} is on the waitlist, position ${position}.`,
  alreadyOnWaitlist: (horse: string) => `${horse} is already on the waitlist.`,
  dayNotFull: 'This barn day has open slots. Book one instead.',

  offerMade: (horse: string, holdEnd: string, zone: string) =>
    `A slot opened for ${horse}. Hold ends at ${holdEnd} (${zone}).`,

  cancelBeforeCutoff: 'Cancelling now is before the cutoff. No trip share applies.',
  cancelBeforeCutoffDeposit: (amount: string) => ` Your $${amount} deposit will be refunded.`,
  cancelAfterCutoff: (cutoff: string, horse: string) =>
    `The cutoff passed at ${cutoff}. ${horse} will still carry a trip share.`,
  cancelAfterCutoffDeposit: (amount: string) =>
    ` Your $${amount} deposit is kept and set against the trip share.`,

  cancellingBooking: 'Cancelling booking…',
  cancelledInTime: 'Booking cancelled. No trip share applies.',
  cancelledLate: (horse: string) => `Booking cancelled. ${horse} still carries a trip share for this day.`,
  dayStarted: 'This day has started. Ask the farrier about this booking.',

  excuseBody: (horse: string, share: string) =>
    `Excuse ${horse} from this day. Its trip share of $${share} moves to the horses not yet invoiced.`,
  excuseBodyDeposit: (amount: string) => ` Its $${amount} deposit will be refunded.`,
  excusingHorse: 'Excusing horse…',
  excused: (horse: string, count: number) => `${horse} excused. Trip shares adjusted for ${count} horses.`,
  noShareRecipient: (horse: string) =>
    `Every other counting horse is already invoiced. Mark ${horse} no-show instead.`,
  cannotExcuse: 'This horse can no longer be excused.',
  dayNotInProgress: 'Start the day before excusing a horse.',

  saving: 'Saving…',
  dayPublished: 'Day published.',
  dayStartedOk: 'Day started. Trip shares are fixed.',
  dayClosed: 'Day closed.',
  dayCancelled: 'Day cancelled.',
  unresolvedBookings:
    'Some horses are still open. Close each visit or mark the horse no-show before closing the day.',
  illegalDayTransition: (status: string) => `That change is not allowed for a ${status} day.`,
  draftSaved: 'Draft saved.',

  importing: 'Importing…',
  importFinished: (createdOwners: number, matchedOwners: number, createdHorses: number, updatedHorses: number) =>
    `Import finished: ${createdOwners} owners created, ${matchedOwners} matched, ` +
    `${createdHorses} horses created, ${updatedHorses} updated.`,
  importInvalid: 'Nothing was imported. Fix the rows listed and try again.',
  importInProgress: 'This import is still running.',

  uploadingPhoto: (percent: number) => `Uploading photo… ${percent}%`,
  photoSaved: (hoof: string, phase: string) => `Photo saved for ${hoof} (${phase}).`,
  photoNotAnImage: 'That file is not a JPEG, PNG or HEIC photo.',
  photoTooLarge: 'That photo is over 8,000,000 bytes.',
  photoStorageDown: 'Photo storage is unreachable. The photo was not saved; try again shortly.',
  quotaExceeded: (remaining: number) => `This visit is out of photo storage: ${remaining} bytes left.`,
  uploadExpired: 'That upload ran out of time. Start it again.',
  visitClosed: 'This visit is closed. Its photos can no longer change.',
  uploadInterrupted: (percent: number) =>
    `Upload interrupted at ${percent}%. Choose the file again to resume.`,

  deletingPhoto: 'Deleting photo…',
  photoDeleted: (hoof: string, phase: string) => `Photo deleted for ${hoof} (${phase}).`,

  savingMarks: 'Saving marks…',
  marksSaved: (wall: string, pastern: string, label: string) =>
    `Marks saved: hoof wall ${wall}°, pastern ${pastern}°, ${label}.`,
  staleMarks: (hoof: string) =>
    `Someone else saved marks for ${hoof} first. Their lines are now shown; check them and save again.`,
  photoRequired: 'Upload the after photo for this hoof first.',

  restoringMarks: 'Restoring marks…',
  marksRestored: (from: number, to: number) => `Restored version ${from} as version ${to}.`,
  marksElsewhere: (name: string, wall: string, pastern: string) =>
    `Marks updated by ${name}: hoof wall ${wall}°, pastern ${pastern}°.`,

  closingVisit: 'Closing visit…',
  visitInvoiced: (amount: string) => `Visit closed and invoiced: $${amount}.`,
  visitPending: 'Visit closed — invoice pending. It will be invoiced when billing is back.',
  closeInProgress: 'This visit is still closing. Its row will update shortly.',
  visitAlreadyClosed: 'This visit is already closed.',

  invoiceReached: (horse: string, amount: string) => `Invoice for ${horse} is now in billing: $${amount}.`,
  tripInvoiceReached: (horse: string, amount: string) =>
    `Trip-share invoice for ${horse} is now in billing: $${amount}.`,

  recordingPayment: 'Recording payment…',
  paymentRecorded: (amount: string) => `Payment of $${amount} recorded.`,
  alreadyPaid: 'This invoice is already paid.',
  invoicePending: 'This invoice is still pending. Try again once it shows as unpaid.',
  billingUnavailable: 'Billing is unreachable. Your payment was not recorded; try again shortly.',
  softDecline: (horse: string, date: string, nextTry: string) =>
    `Payment failed: ${horse} on ${date}. We will try again on ${nextTry}.`,
  hardDecline: (horse: string, date: string) =>
    `Account on hold: ${horse} on ${date}. New bookings are on hold until this invoice is paid.`,
  declineWhileBlocked: 'Your card was declined. This invoice is still unpaid.',

  sendingLink: 'Sending link…',
  linkSent: (email: string) => `Comparison link sent to ${email}.`,
  needsTwoVisits: 'This horse needs two closed visits before a vet link can be sent.',
  revoking: 'Revoking…',
  linkRevoked: 'Link revoked.',
  sendingNewLink: 'Sending new link…',
  newLinkSent: (email: string) => `New link sent to ${email}. The old link no longer works.`,

  priceListSaved: 'Price list saved.',
  priceListExists: 'A price list already starts on that date.',

  tokenCreated: "Copy this token now. It won't be shown again.",
  tokenRevoked: 'Token revoked.',

  preparingExport: 'Preparing export…',
  exportReady: 'Export ready.',
  exportFailed: 'The export failed. It can be retried from the job list.',

  outstandingAlert: (amount: string) => `Outstanding balance over $${amount}`,

  rateLimited: (seconds: number) => `Too many attempts. Try again in ${seconds} seconds.`,
  networkFailure: "Clinchline can't reach the server. Check your connection and try again.",

  vetLinkGone: 'This comparison link is no longer available.',
  dayNotAvailable: "This barn day isn't available.",
  horseNotAvailable: "This horse isn't available.",
} as const;

export const fieldCopy = {
  email: 'Enter a valid email address.',
  required: 'This is required.',
  pastDate: 'Pick today or a later date.',
  amount: 'Enter an amount in dollars, like 45.00.',
  coordinates: 'Keep both points inside the photo and apart from each other.',
} as const;

export const HOOF_NAMES: Record<string, string> = {
  LF: 'Left fore',
  RF: 'Right fore',
  LH: 'Left hind',
  RH: 'Right hind',
};

export const WORK_LABELS: Record<string, string> = {
  trim: 'Trim',
  front_reset: 'Front shoes, reset',
  full_reset: 'Full set, reset',
  front_new: 'Front shoes, new',
  full_new: 'Full set, new',
};

export const CARD_OPTIONS = [
  { token: 'tok_approve_4242', label: 'Test card 4242 (approves)' },
  { token: 'tok_decline_0002', label: 'Test card 0002 (declines)' },
  { token: 'tok_funds_9995', label: 'Test card 9995 (insufficient funds)' },
] as const;
