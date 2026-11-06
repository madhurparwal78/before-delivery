// Every published string, exactly as the brief prints it.

import { DOCUMENT_LABEL, type DocumentKind } from "../shared/documents.js";
import { formatHours } from "../shared/hours.js";

export const copy = {
  unexpected: "Something went wrong. Try again.",
  signIn: {
    pending: "Signing in…",
    mismatch: "That email and password don't match.",
  },
  apply: {
    pending: "Sending application…",
    received: "Application received. Upload your three documents to move to review.",
  },
  packs: {
    pending: "Processing purchase…",
    paid: (minutes: number) => `Paid. ${formatHours(minutes)} hours added to your balance. Your receipt is on its way.`,
    outage: "Pack purchases are unavailable right now. You can still book with the hours you already own.",
    declined: "The payment didn't go through. No hours were added.",
    availableAgain: "Pack purchases are available again.",
  },
  upload: {
    pending: "Uploading…",
    done: (kind: DocumentKind) => `${DOCUMENT_LABEL[kind]} uploaded. It's waiting for review.`,
    tooLarge: "That file is larger than 5,000,000 bytes.",
    wrongType: "Upload a PDF, PNG or JPEG scan.",
    storageDown: "File storage is unreachable. Try the upload again in a minute.",
  },
  sweep: {
    step: (station: string, start: string, end: string, minutes: number, bufferEnd: string) =>
      `${station}, ${start} to ${end}, ${formatHours(minutes)} hours, buffer until ${bufferEnd}.`,
    taken: "That time is taken.",
    stop: (end: string, reason: string) => `Can't extend past ${end}: ${reason}.`,
    reasons: {
      booking: (at: string) => `another booking starts at ${at}`,
      buffer: (until: string) => `another booking's buffer runs until ${until}`,
      maintenance: (at: string) => `maintenance starts at ${at}`,
      sixHours: "six hours is the longest booking",
      dayEnd: "the kitchen day ends at 24:00",
      balance: (minutes: number) => `your balance covers ${formatHours(minutes)} hours`,
    },
  },
  hold: {
    pending: "Placing hold…",
    placed: (station: string, start: string, end: string) => `Hold placed on ${station} ${start} to ${end}. Confirm before the countdown ends.`,
    lostShrunk: (end: string) => `Another renter claimed this time first. Your ticket now ends at ${end}.`,
    lostRemoved: "Another renter claimed this time first. Your ticket was removed.",
    short: (needed: number, balance: number) => `You need ${formatHours(needed)} hours and have ${formatHours(balance)}. Buy a pack to continue.`,
    lapsed: "Bookings are paused until your certificate of insurance and food-handler card are current.",
    notActive: "Your account isn't active yet.",
  },
  booking: {
    confirming: "Confirming…",
    confirmed: "Booking confirmed. A confirmation email is on its way.",
    expired: "This hold ran out and the time was released.",
    releasing: "Releasing…",
    released: (minutes: number) => `Hold released. ${formatHours(minutes)} hours returned to your balance.`,
    cancelling: "Cancelling…",
    cancelledCredited: (minutes: number) => `Booking cancelled. ${formatHours(minutes)} hours returned to your balance.`,
    cancelledForfeited: (minutes: number) => `Booking cancelled. ${formatHours(minutes)} hours were forfeited because it was within 48 hours of the start.`,
    outcomeReturns: (minutes: number) => `Cancelling now returns ${formatHours(minutes)} hours.`,
    outcomeForfeits: (minutes: number) => `Cancelling now forfeits ${formatHours(minutes)} hours.`,
    displaced: (station: string, start: string, end: string, minutes: number) =>
      `Your booking on ${station} ${start}–${end} was displaced by maintenance. ${formatHours(minutes)} hours returned to your balance.`,
    noLongerActive: "This booking is no longer active.",
  },
  shift: {
    saving: "Saving…",
    checkedIn: (at: string) => `Checked in at ${at}.`,
    checkedOutOverage: (units: number, usd: string) => `Checked out. Overage: ${units} × 15 minutes, $${usd}.`,
    checkedOutNone: "Checked out. No overage.",
    billingDown: "Billing is unreachable, so this check-out wasn't recorded. Try again in a minute.",
    blocked: (count: number) => `Station blocked. ${count} bookings displaced. Affected renters are being emailed.`,
    inUse: "Someone is checked in on that station during that time.",
  },
  operator: {
    saving: "Saving…",
    approved: (label: string) => `${label} approved.`,
    rejected: (label: string) => `${label} rejected.`,
    activated: "Renter activated.",
    offboarded: "Renter offboarded.",
    adjusted: "Adjustment recorded.",
    settingsSaved: (date: string) => `Settings saved. They apply to bookings created from ${date}.`,
    incomplete: "Every document must be approved and current first.",
    documentExpired: "That document has already expired.",
    shelfStarted: (business: string) => `Shelf subscription started for ${business}.`,
    shelfEnded: (business: string) => `Shelf subscription ended for ${business}.`,
    billingDown: "Billing is unreachable. Try again in a minute.",
    shelfNotActive: "That renter must be active to start a shelf subscription.",
    linkCreated: (until: string) => `Link created. It works until ${until}.`,
    linkRevoked: "Link revoked.",
    linkRegenerated: "New link created. The old link no longer works.",
  },
  statement: {
    pending: "Creating statement…",
    ready: (month: string) => `Statement for ${month} is ready.`,
  },
  share: {
    deadHeading: "This link is no longer active",
    deadBody: "Ask the kitchen operator for a new link.",
  },
  empty: {
    board: "No bookings on this day.",
    ledger: "No hour movements yet.",
    statements: "No statements yet.",
    links: "No compliance links yet.",
    sheet: "No bookings on this day.",
    share: "No current documents to show.",
  },
} as const;
