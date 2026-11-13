// Published copy (brief: Feedback states), character for character. The server's error
// messages and the browser's live regions both read it from here.

import type { Currency } from "./money.js";
import { formatPrice } from "./money.js";

export const COPY = {
  notFoundHeading: "We couldn't find that room.",
  emptyEvents: "No timeline events in this chapter yet.",
  mediaUnavailable: "This media is unavailable right now.",
  noWebgl: "Your browser can't show the 3D scene, so here are its viewpoints.",
  bookmarkRemoved: "Bookmark removed.",

  wrongCredentials: "Email or password is incorrect.",
  nameField: "Enter your name.",
  emailField: "Enter a valid email address.",
  passwordField: "Use 10 to 72 characters.",
  emailTaken: "An account with this email already exists.",
  accountsDown: "Accounts are unavailable right now. You can keep exploring, but your path won't be saved until they're back.",

  processing: "Processing payment, please wait.",
  booked: "You're booked",
  thanks: "Thank you for your donation",
  lostReply: "Connection lost. Press Donate again to finish safely.",
  cancelledOverdue: "Your membership has been cancelled.",
  undone: "Your pending change was undone.",
  retryOk: "Payment received. Your membership is active.",
  cardUpdated: "Card updated.",
  receiptDelayed: "Your receipt email is delayed. It will arrive once our mail service is back.",

  bookingClosed: "Booking for this session has closed.",
  soldOut: "Not enough seats left for this session.",
  cardDeclined: "Your card was declined. You have not been charged.",
  alreadyMember: "You're already a supporter. Change your plan instead.",
  changePending: "Undo your pending change before making another.",
  paymentOverdue: "Settle your overdue payment before changing your plan.",
  nothingPending: "There's no pending change to undo.",
  nothingDue: "There's nothing to pay right now.",
  notAMember: "You don't have a supporter membership.",
  cardField: "Enter a valid card number.",
  seatsField: "Choose between 1 and 4 seats.",
  amountFormat: "Enter an amount such as 25.00, or a whole number for yen.",
  billingDown: "Payments are unavailable right now. You have not been charged. Please try again shortly.",
  pricesDown: "Prices are unavailable right now.",
  storagePurchase: "We can't issue tickets or receipts right now. You have not been charged. Please try again shortly.",

  draftSaved: "Draft saved.",
  notEditable: "Only drafts can be edited.",
  leadOnly: "Only the lead curator can schedule items.",
  forbidden: "You can't change this item.",
  afterNow: "Choose a time after now.",
  skippedTime: "That time doesn't exist in Lisbon because the clocks go forward. Choose another time.",
  reasonField: "Give a reason of 3 to 500 characters.",
  fileType: "This file type isn't accepted here.",
  fileSize: "Files must be 20,000,000 bytes or smaller.",
  transcriptField: "Narration needs a transcript.",
  storageUpload: "Media storage is unavailable right now. Your file was not uploaded.",

  sessionCreated: "Session created.",
  sessionTitleField: "Give a title of 3 to 120 characters.",
  durationField: "Choose between 15 and 240 minutes.",
  capacityField: "Choose between 1 and 200 seats.",
  notCancellable: "This session can no longer be cancelled.",
  fullyRefunded: "This order is already fully refunded.",
  noteAdded: "Note added.",
  priceConflict: "A later price change is already scheduled.",
  afterToday: "Choose a date after today.",

  unauthenticated: "Please sign in.",
  notFound: "We couldn't find that.",
  forbiddenOrigin: "Request refused.",
  keyRequired: "Missing idempotency key.",
  keyConflict: "This request key was already used for a different request.",
  tooLarge: "That request is too large.",
  sendJson: "Send JSON.",
  validation: "Check the highlighted fields.",
} as const;

export const TIER_NAMES = { reader: "Reader", fellow: "Fellow", patron: "Patron" } as const;
export type Tier = keyof typeof TIER_NAMES;
export const TIERS: readonly Tier[] = ["reader", "fellow", "patron"];

export const copyFor = {
  chapterResolved: (numeral: string) => `Chapter ${numeral} resolved.`,
  regime: (regime: string) => `Spring is ${regime}.`,
  ruleResults: (classified: number) => `${classified} of 12 specimens classified.`,
  heldOut: (accuracy: string) => `Held-out accuracy ${accuracy}%.`,
  trained: (accuracy: string, epochs: number) => `Training finished. Held-out accuracy ${accuracy}% after ${epochs} epochs.`,
  neighbours: (word: string, context: string | null, words: string[]) =>
    context ? `Nearest to ${word} near ${context}: ${words.join(", ")}.` : `Nearest to ${word}: ${words.join(", ")}.`,
  searchCount: (count: number, query: string) => (count === 1 ? `1 result for "${query}".` : `${count} results for "${query}".`),
  nothingMatches: (query: string) => `Nothing in the archive matches "${query}".`,
  bookmarked: (title: string) => `Bookmarked ${title}.`,
  signedIn: (name: string) => `Signed in as ${name}.`,
  booked: (seats: number, title: string) => (seats === 1 ? `Booked 1 seat for ${title}.` : `Booked ${seats} seats for ${title}.`),
  confirmation: (title: string, datetime: string, ticket: string) => `${title}, ${datetime}. Ticket ${ticket}.`,
  donationReceived: (price: string) => `Donation of ${price} received.`,
  welcome: (tierName: string) => `Welcome, ${tierName} supporter.`,
  upgraded: (tierName: string) => `You're now a ${tierName} supporter.`,
  downgradePending: (tierName: string, date: string) => `Your change to ${tierName} is pending until ${date}.`,
  endsOn: (date: string) => `Your membership ends on ${date}.`,
  changesTo: (tierName: string, date: string) => `Changes to ${tierName} on ${date}.`,
  membershipEnds: (date: string) => `Ends on ${date}.`,
  overdue: (price: string) => `Payment of ${price} is overdue.`,
  nextPayment: (price: string, date: string) => `Next payment ${price} on ${date}.`,
  planPrice: (price: string) => `${price} a month`,
  bookingPrice: (price: string, seats: number) => `${price} for ${seats} seats`,
  seatsLeft: (n: number) => (n === 1 ? "1 seat left" : `${n} seats left`),
  seatPrice: (price: string) => `${price} a seat`,
  scheduledChange: (date: string, price: string) => `From ${date}: ${price} a month`,
  currencyLocked: (currency: Currency) => `Your supporter account pays in ${currency}. Choose ${currency} to continue.`,
  sameTier: (tierName: string) => `You're already on the ${tierName} tier.`,
  donationBounds: (min: number, max: number, currency: Currency) =>
    `Enter an amount between ${formatPrice(min, currency)} and ${formatPrice(max, currency)}.`,
  moved: (label: string) => `Moved to ${label}.`,
  illegalTransition: (label: string) => `That move isn't allowed from ${label}.`,
  uploading: (file: string) => `Uploading ${file}.`,
  uploaded: (file: string) => `Upload complete: ${file}.`,
  sessionCancelled: (refunds: number) => `Session cancelled. ${refunds} bookings refunded.`,
  refundIssued: (price: string) => `Refund of ${price} issued.`,
  refundCap: (price: string) => `Refund can't exceed ${price}.`,
  priceScheduled: (date: string) => `New price scheduled from ${date}.`,
  difference: (price: string) => `Difference ${price}`,
};

export const SESSION_STATUS_LABELS = { on_sale: "On sale", closed: "Closed", held: "Held", cancelled: "Cancelled" } as const;
export type SessionStatus = keyof typeof SESSION_STATUS_LABELS;

export const MEMBERSHIP_STATUS_LABELS = {
  active: "Active",
  pending_change: "Pending change",
  overdue: "Overdue",
  cancelled: "Cancelled",
} as const;
export type MembershipStatus = keyof typeof MEMBERSHIP_STATUS_LABELS;

export const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;
