import { formatKroner } from './money.js';

/** The one source for every published copy string. */

export const storyCopy = {
  matchOut: 'The match went out. Strike another.',
  bundleOut: 'The bundle went out.',
  holdPending: (n: number) => `Reaching for box ${n}...`,
  holdGranted: (n: number) => `Box ${n} is yours while this match burns.`,
  holdReleased: (n: number) => `Box ${n} is back on the shelf.`,
} as const;

export const bannerCopy = {
  sales_paused: 'Sales are paused because the shelf cannot be reached. The tale is still here.',
  edition_closed: 'This edition closed on 1 February 2027.',
} as const;

export const paymentStateCopy = {
  started: 'Asking your bank...',
  challenge: 'Your bank wants to check it is you.',
  authorised: 'Your card is authorised. You have not been charged yet.',
  captured: 'Your card has been charged.',
  partially_refunded: 'Part of your payment has been refunded.',
  refunded: 'Your payment has been refunded.',
  voided: 'This authorisation was cancelled. You have not been charged.',
  capture_failed: 'We could not charge your card. The press will be in touch.',
  authorisation_expired: 'This authorisation lapsed. You have not been charged.',
  pending: 'Waiting for your bank transfer.',
  settled: 'Your transfer has arrived.',
} as const;

export const declineCopy = {
  do_not_honor: 'Your bank declined this card. Try another card; your match keeps burning.',
  insufficient_funds: 'This card has too little in it. Try another card; your match keeps burning.',
  expired_card: 'This card has expired. Try another card; your match keeps burning.',
  challenge_failed: 'The bank could not confirm it was you. Try again; your match keeps burning.',
  challenge_cancelled: "You cancelled the bank's check. Try again; your match keeps burning.",
  challenge_expired: "The bank's check ran out of time. Try again; your match keeps burning.",
} as const;

export const fieldCopy = {
  'buyer.name': 'Enter your name.',
  'buyer.email': 'Enter a valid email address.',
  'address.street': 'Enter a street address.',
  'address.postcode': 'Enter a four-digit postcode.',
  'address.city': 'Enter a city.',
  'gift.recipientName': "Enter the recipient's name.",
  'gift.recipientEmail': "Enter the recipient's email address.",
  'gift.message': 'Keep the gift message to 280 characters.',
  'card.number': 'Enter the 16-digit card number.',
  'card.expiry': 'Enter the expiry as MM/YY.',
  'card.cvc': 'Enter the three-digit security code.',
} as const;

export const staffCopy = {
  packingStarted: (n: number) => `Packing box ${n}...`,
  packed: (n: number) => `Box ${n} is packed.`,
  shipped: (n: number) => `Box ${n} is shipped.`,
  backOnShelf: (n: number) => `Box ${n} is back on the shelf.`,
  refundPending: 'Refund pending.',
  refundSettled: 'Refund settled.',
  rateScheduled: 'New rate scheduled.',
  statementIssued: 'Statement issued.',
  artSaved: 'Plate art saved.',
  noDeadLetters: 'No events are waiting for you.',
  deadLetterRetried: 'Event sent back to the queue.',
  deadLetterDismissed: 'Event dismissed.',
  searchFallback: 'Search is limited to exact numbers and names for now.',
  eventsWaiting: 'Events are waiting for the queue. Nothing is lost.',
  alertsWaiting: 'Phone alerts are waiting to be sent.',
} as const;

/**
 * Error copy by code. Codes whose copy names a box number are functions of it;
 * `error.message` on the API carries exactly these characters.
 */
export const errorCopy = {
  hold_ended: (n: number) => `Your match went out. Box ${n} is back on the shelf.`,
  box_held: (n: number) => `Someone else is holding box ${n}. Choose another number.`,
  box_taken: (n: number) => `Box ${n} has already found a home. Choose another number.`,
  hold_not_yours: 'This hold belongs to someone else.',
  authorised_too_late: 'Your match went out before the bank replied. You have not been charged.',
  lapsed: (n: number) => `Your transfer deadline passed. Box ${n} is back on the shelf.`,
  capture_refused: (n: number) => `The card could not be captured for box ${n}. Try packing again.`,
  sales_paused: bannerCopy.sales_paused,
  edition_closed: bannerCopy.edition_closed,
  lookup_refused: 'We could not find an order with that reference and email.',
  lookup_limited: 'Too many tries. Please wait before trying again.',
  certificate_pending: 'Your certificate is being prepared.',
  certificate_cancelled: 'This certificate was cancelled when the box was refunded.',
  art_wrong_type: 'Plate art must be a PNG or JPEG file.',
  art_too_large: 'Plate art must be 5,000,000 bytes or smaller.',
  art_too_many_pixels: 'Plate art must be 6,000 pixels or fewer on each side.',
  refund_exceeds_remainder: 'That is more than remains on this box.',
  refund_invalid: 'Enter an amount above zero.',
  rate_must_be_future: 'A new rate must start in the future.',
  rate_invalid: 'Enter a rate from 0 to 100 percent.',
  month_invalid: 'Enter a month that has started, as YYYY-MM.',
  dismissal_note_required: 'Add a note of up to 280 characters.',
  endpoint_invalid: 'Enter a full http or https address.',
  validation_failed: 'Please check the highlighted fields.',
  illegal_transition: "That cannot be done in this box's current state.",
  not_captured: 'This order has not been charged yet.',
  idempotency_conflict: 'That request key was already used for something else.',
  sign_in_required: 'Please sign in.',
  forbidden: 'Your role cannot do this.',
  not_found: 'We could not find that.',
  origin_refused: 'This request came from another site.',
  body_too_large: 'That request is too large.',
  unsupported_media_type: 'That request type is not accepted.',
  bad_signature: 'Signature refused.',
  authorisation_expired: paymentStateCopy.authorisation_expired,
  identity_unreachable: 'Sign-in is unavailable right now. Try again shortly.',
  search_unreachable: 'Search is resting. The tale and the shelf still work.',
  queue_unreachable: 'The dead-letter list cannot be read right now. Nothing is lost.',
  pdf_unreachable: 'The PDF service is down. No statement was issued; try again shortly.',
  deliveries_unreachable: 'Delivery state cannot be read right now. Events are kept and will be sent.',
  ...declineCopy,
} as const;

/** Outage copy that differs by the surface asking for it. */
export const outageCopy = {
  checkout: {
    gateway_unreachable: "The bank's line is down. Your match keeps burning; try again in a moment.",
    ledger_unreachable: "We can't record payments right now. Your match keeps burning; try again in a moment.",
  },
  pack: {
    gateway_unreachable: 'The gateway is down. Nothing was captured.',
    ledger_unreachable: 'The ledger is down. Nothing was captured.',
  },
  refund: {
    gateway_unreachable: 'The gateway is down. No refund was started.',
    ledger_unreachable: 'The ledger is down. No refund was started.',
  },
  uploadStorage: 'Plate storage is down. Nothing was saved; try again shortly.',
  downloadStorage: 'Downloads are unavailable right now. Try again shortly.',
} as const;

export type OutageSurface = 'checkout' | 'pack' | 'refund';

export const chapters = ['alley', 'stove', 'goose', 'tree', 'star', 'grandmother', 'shelf'] as const;
export type Chapter = (typeof chapters)[number];

export const plates = ['Stove', 'Goose', 'Tree', 'Star', 'Grandmother'] as const;
export type Plate = (typeof plates)[number];

/** Plate = (number - 1) mod 5 across Stove, Goose, Tree, Star, Grandmother. */
export function plateFor(boxNumber: number): Plate {
  return plates[(boxNumber - 1) % 5] as Plate;
}

export const EDITION_SIZE = 240;

export { formatKroner };
