// Every piece of copy the brief pins (brief: Feedback states), in one place.
import { clockTime, dateText, deadlineText } from "../shared/brussels.ts";
import { euro } from "../shared/money.ts";

const t = (iso: string) => clockTime(Date.parse(iso));
const d = (iso: string) => deadlineText(Date.parse(iso));

export const copy = {
  results: (n: number) => (n === 1 ? "1 session" : `${n} sessions`),
  added: (title: string) => `Added ${title} to your agenda.`,
  removed: (title: string) => `Removed ${title} from your agenda.`,
  clashCount: (n: number) => (n === 0 ? "No clashes in your agenda." : `${n} clashes in your agenda.`),
  clashWith: (title: string) => `Clash with ${title}`,
  seatsLeft: (n: number, capacity: number) => `${n} of ${capacity} seats left`,

  holding: "Holding your seat…",
  held: (expiresAt: string) => `Seat held until ${t(expiresAt)}.`,
  soldOut: "That was the last seat. Join the waitlist to be offered the next one.",
  holdExpired: (title: string) => `Your hold on ${title} expired and the seat was released.`,
  waitlistJoined: (n: number, title: string) => `You're number ${n} on the waitlist for ${title}.`,
  offerLapsed: (at: string) => `This offer lapsed at ${t(at)} and the seat went to the next person.`,
  paying: "Processing payment…",
  fullRateDone: (ref: string, email: string) => `Order ${ref} confirmed. We're emailing your passes to ${email}.`,
  reducedDone: (ref: string, deadline: string) => `Order ${ref} received. Upload your proof by ${d(deadline)}. We hold your payment until then and only take it once your rate is approved.`,
  groupDone: (ref: string, number: string, due: string) => `Order ${ref} placed. Invoice ${number} is due on ${dateText(Date.parse(due))}.`,
  paymentsDown: (heldUntil: string | null) => heldUntil
    ? `Payments are unavailable right now. Nothing was charged and your seats stay held until ${t(heldUntil)}. Try again in a moment.`
    : "Payments are unavailable right now. Nothing was charged. Try again in a moment.",
  passesDown: "We couldn't issue your passes right now. Nothing was charged. Try again in a moment.",
  sessionCancelled: (title: string) => `${title} was cancelled. Remove it to continue.`,
  voucherUnknown: "We don't recognise this voucher code.",
  voucherEmpty: "This voucher has no balance left.",
  groupMinimum: "Group bookings need at least 5 tickets.",
  attendeeNames: "Enter a name for every attendee.",

  mailSent: "Confirmation email: sent",
  mailPending: "Confirmation email: pending — we'll send it as soon as our mail service is back.",
  proofPending: "Reduced rate awaiting proof — payment authorised, not taken.",
  rejected: "Reduced rate not approved — your payment authorisation was released.",
  lapsed: "Proof deadline passed — your payment authorisation was released.",
  refundPending: "Refund pending — we'll complete it as soon as our payment service is back.",
  passDown: "Your pass is safe but can't be downloaded right now. Try again in a moment.",
  transferring: "Transferring…",
  transferred: (name: string) => `Transferred to ${name}. Their new pass is on its way and your old pass no longer scans.`,
  transferDown: "We couldn't issue the new pass right now. Nothing changed — try again in a moment.",

  uploading: "Uploading…",
  proofReceived: (deadline: string) => `Proof received. We'll decide by ${d(deadline)}.`,
  imageUploaded: "Image uploaded.",
  proofTooLarge: "This file is larger than 5,000,000 bytes.",
  imageTooLarge: "This image is larger than 10,000,000 bytes.",
  proofWrongType: "Upload a PDF, JPEG or PNG file.",
  imageWrongType: "Upload a JPEG, PNG or WebP image.",
  badFileName: "This file name isn't allowed. Rename the file and try again.",
  storageDown: "We couldn't store your file right now. Try again in a moment.",
  submitted: (title: string) => `${title} sent for review.`,

  approved: (ref: string) => `Approved — payment taken for order ${ref}.`,
  rejectedProof: (ref: string) => `Rejected — authorisation released for order ${ref}.`,
  decisionLate: (ref: string) => `The proof deadline for order ${ref} has passed; the authorisation was released.`,
  decisionPaymentsDown: "The payment service is unavailable. Nothing changed — try again in a moment.",
  decisionStorageDown: "Passes can't be issued right now. Nothing changed — the proof is still pending. Try again in a moment.",
  admitted: (holder: string, item: string) => `Admitted — ${holder}, ${item}`,
  refusal: {
    already_admitted: (at: string | null) => `Already admitted at ${at ? t(at) : ""}`.trim(),
    pass_transferred: () => "This pass was transferred — ask for the new pass",
    pass_refunded: () => "This pass was refunded",
    pass_voided: () => "This pass is not valid",
    not_entitled: () => "This pass doesn't cover this session",
    session_cancelled: () => "This session is cancelled",
  },
  unknownPass: "Unknown pass code",

  moved: (title: string, state: string) => `${title} moved to ${state}.`,
  illegal: (title: string, from: string, to: string) => `${title} can't move from ${from} to ${to}.`,
  stale: (title: string) => `Someone else changed ${title}. Reload to see their version.`,
  notInFuture: "Choose a publishing time in the future.",
  cancelledWithRefunds: (title: string, n: number) => `${title} cancelled. Refunds started for ${n} orders.`,

  reconciling: "Reconciling with the payment service…",
  reconciled: (n: number) => `${n} open mismatches.`,
  resolved: "Mismatch resolved.",
  noteMissing: "Write a note explaining the resolution.",
  returnRetry: (date: string) => `Return recorded. Next retry on ${dateText(Date.parse(date))}.`,
  returnWrittenOff: (number: string) => `Return recorded. Invoice ${number} is written off.`,
  refundStarted: (n: number) => `Refund started for ${n} lines.`,
  voucherIssued: (code: string, cents: number) => `Voucher ${code} issued for ${euro(cents)}.`,
  financeKbDown: "The payment service is unavailable. Try again in a moment.",
  collectionPending: "Collection pending — we'll collect as soon as our payment service is back.",

  saved: "Saved.",
  stalePrices: "Someone else changed these prices. Reload to see their version.",
  lastAdmin: "There must be at least one admin.",

  badCredentials: "That email and password don't match.",
  emailTaken: "An account with this email already exists.",
};
