import type { Chapter } from "./domain.js";

/** Every published sentence of the product, written once and imported by server and client alike. */

interface ErrorSpec {
  status: number;
  message: (number?: number) => string;
}

const fixed = (status: number, message: string): ErrorSpec => ({ status, message: () => message });

export const ERRORS = {
  box_held: { status: 409, message: (n = 0) => `Someone else is holding box ${n}. Choose another number.` },
  box_taken: { status: 409, message: (n = 0) => `Box ${n} has already found a home. Choose another number.` },
  hold_not_yours: fixed(403, "This hold belongs to someone else."),
  hold_ended: { status: 410, message: (n = 0) => `Your match went out. Box ${n} is back on the shelf.` },
  edition_closed: fixed(409, "This edition closed on 1 February 2027."),
  sales_paused: fixed(503, "Sales are paused because the shelf cannot be reached. The tale is still here."),
  do_not_honor: fixed(402, "Your bank declined this card. Try another card; your match keeps burning."),
  insufficient_funds: fixed(402, "This card has too little in it. Try another card; your match keeps burning."),
  expired_card: fixed(402, "This card has expired. Try another card; your match keeps burning."),
  challenge_failed: fixed(402, "The bank could not confirm it was you. Try again; your match keeps burning."),
  challenge_cancelled: fixed(402, "You cancelled the bank's check. Try again; your match keeps burning."),
  challenge_expired: fixed(410, "The bank's check ran out of time. Try again; your match keeps burning."),
  authorised_too_late: fixed(410, "Your match went out before the bank replied. You have not been charged."),
  lookup_refused: fixed(404, "We could not find an order with that reference and email."),
  lookup_limited: fixed(429, "Too many tries. Please wait before trying again."),
  certificate_pending: fixed(409, "Your certificate is being prepared."),
  certificate_cancelled: fixed(410, "This certificate was cancelled when the box was refunded."),
  capture_refused: { status: 402, message: (n = 0) => `The card could not be captured for box ${n}. Try packing again.` },
  art_wrong_type: fixed(415, "Plate art must be a PNG or JPEG file."),
  art_too_large: fixed(413, "Plate art must be 5,000,000 bytes or smaller."),
  art_too_many_pixels: fixed(422, "Plate art must be 6,000 pixels or fewer on each side."),
  refund_exceeds_remainder: fixed(422, "That is more than remains on this box."),
  refund_invalid: fixed(422, "Enter an amount above zero."),
  rate_must_be_future: fixed(422, "A new rate must start in the future."),
  rate_invalid: fixed(422, "Enter a rate from 0 to 100 percent."),
  month_invalid: fixed(422, "Enter a month that has started, as YYYY-MM."),
  dismissal_note_required: fixed(422, "Add a note of up to 280 characters."),
  endpoint_invalid: fixed(422, "Enter a full http or https address."),
  validation_failed: fixed(422, "Please check the highlighted fields."),
  illegal_transition: fixed(409, "That cannot be done in this box's current state."),
  authorisation_expired: fixed(409, "This authorisation lapsed. You have not been charged."),
  not_captured: fixed(409, "This order has not been charged yet."),
  idempotency_conflict: fixed(409, "That request key was already used for something else."),
  sign_in_required: fixed(401, "Please sign in."),
  forbidden: fixed(403, "Your role cannot do this."),
  not_found: fixed(404, "We could not find that."),
  origin_refused: fixed(403, "This request came from another site."),
  body_too_large: fixed(413, "That request is too large."),
  unsupported_media_type: fixed(415, "That request type is not accepted."),
  bad_signature: fixed(401, "Signature refused."),
  gateway_unreachable: fixed(503, "The bank's line is down. Your match keeps burning; try again in a moment."),
  ledger_unreachable: fixed(503, "We can't record payments right now. Your match keeps burning; try again in a moment."),
  search_unreachable: fixed(503, "Search is resting. The tale and the shelf still work."),
  queue_unreachable: fixed(503, "The dead-letter list cannot be read right now. Nothing is lost."),
  pdf_unreachable: fixed(503, "The PDF service is down. No statement was issued; try again shortly."),
  storage_unreachable: fixed(503, "Plate storage is down. Nothing was saved; try again shortly."),
  deliveries_unreachable: fixed(503, "Delivery state cannot be read right now. Events are kept and will be sent."),
  identity_unreachable: fixed(503, "Sign-in is unavailable right now. Try again shortly."),
  internal_error: fixed(500, "Something went wrong on our side."),
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERRORS;

/** Outage copy that depends on which operation met the outage. */
export const OUTAGE_COPY = {
  pack: {
    gateway_unreachable: "The gateway is down. Nothing was captured.",
    ledger_unreachable: "The ledger is down. Nothing was captured.",
  },
  refund: {
    gateway_unreachable: "The gateway is down. No refund was started.",
    ledger_unreachable: "The ledger is down. No refund was started.",
  },
  download: "Downloads are unavailable right now. Try again shortly.",
} as const;

export const FIELD_ERRORS = {
  "buyer.name": "Enter your name.",
  "buyer.email": "Enter a valid email address.",
  "address.street": "Enter a street address.",
  "address.postcode": "Enter a four-digit postcode.",
  "address.city": "Enter a city.",
  "gift.recipientName": "Enter the recipient's name.",
  "gift.recipientEmail": "Enter the recipient's email address.",
  "gift.message": "Keep the gift message to 280 characters.",
  "card.number": "Enter the 16-digit card number.",
  "card.expiry": "Enter the expiry as MM/YY.",
  "card.cvc": "Enter the three-digit security code.",
} as const;

export type FieldName = keyof typeof FIELD_ERRORS;

/** Maker push alerts (ntfy): box numbers and amounts only, never a name, email, address or gift message. */
export const ALERT_COPY = {
  captureFailed: (number: number, amount: string) => ({ title: "Capture failed", message: `Box ${number}: capture of ${amount} failed.` }),
  authorisationExpired: (number: number, amount: string) => ({
    title: "Authorisation expired", message: `Box ${number}: authorisation of ${amount} expired and was voided.`,
  }),
  deadLettered: (eventId: string, number: number) => ({
    title: "Event dead-lettered", message: `Event ${eventId} for box ${number} reached the dead-letter list.`,
  }),
  lowStock: (remaining: number) => ({ title: "Low stock", message: `${remaining} boxes remain.` }),
} as const;

export const MAIL_SUBJECTS = {
  authorisation: (number: number, reference: string) => `Box ${number} is reserved: card authorised (${reference})`,
  transfer: (number: number, reference: string) => `Bank transfer instructions for box ${number} (${reference})`,
  receipt: (number: number, reference: string) => `Your receipt for box ${number} (${reference})`,
  lapse: (number: number, reference: string) => `Your transfer deadline passed: box ${number} (${reference})`,
  refund: (number: number, reference: string) => `Refund for box ${number} (${reference})`,
  gift: "A numbered box is on its way to you",
} as const;

export const STORY_COPY = {
  matchOut: "The match went out. Strike another.",
  bundleOut: "The bundle went out.",
  holdPending: (n: number) => `Reaching for box ${n}...`,
  holdGranted: (n: number) => `Box ${n} is yours while this match burns.`,
  holdReleased: (n: number) => `Box ${n} is back on the shelf.`,
} as const;

export const PAYMENT_COPY = {
  started: "Asking your bank...",
  challenge: "Your bank wants to check it is you.",
  authorised: "Your card is authorised. You have not been charged yet.",
  captured: "Your card has been charged.",
  partially_refunded: "Part of your payment has been refunded.",
  refunded: "Your payment has been refunded.",
  voided: "This authorisation was cancelled. You have not been charged.",
  capture_failed: "We could not charge your card. The press will be in touch.",
  authorisation_expired: ERRORS.authorisation_expired.message(),
  pending: "Waiting for your bank transfer.",
  settled: "Your transfer has arrived.",
  lapsed: (n: number) => `Your transfer deadline passed. Box ${n} is back on the shelf.`,
  declined: ERRORS.do_not_honor.message(),
} as const;

export const STAFF_COPY = {
  packing: (n: number) => `Packing box ${n}...`,
  packed: (n: number) => `Box ${n} is packed.`,
  shipped: (n: number) => `Box ${n} is shipped.`,
  backOnShelf: (n: number) => STORY_COPY.holdReleased(n),
  refundPending: "Refund pending.",
  refundSettled: "Refund settled.",
  rateScheduled: "New rate scheduled.",
  statementIssued: "Statement issued.",
  artSaved: "Plate art saved.",
  noDeadLetters: "No events are waiting for you.",
  retried: "Event sent back to the queue.",
  dismissed: "Event dismissed.",
  searchFallback: "Search is limited to exact numbers and names for now.",
  eventsWaiting: "Events are waiting for the queue. Nothing is lost.",
  alertsWaiting: "Phone alerts are waiting to be sent.",
} as const;

/** Header on staff responses naming what is waiting for a service: `queue`, `alerts`. */
export const WAITING_HEADER = "x-press-waiting";

export const CHAPTER_TITLES: Record<Chapter, string> = {
  alley: "The last evening",
  stove: "The stove",
  goose: "The goose",
  tree: "The tree",
  star: "The falling star",
  grandmother: "The grandmother",
  shelf: "The shelf",
};

export const MATCHBOX = { strike: "Strike a match", next: "Next chapter", previous: "Previous chapter" } as const;
