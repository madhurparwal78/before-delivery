/** The one source of every published copy string. Format helpers substitute values. */
export const copy = {
  story: {
    matchOut: 'The match went out. Strike another.',
    bundleOut: 'The bundle went out.',
  },
  hold: {
    pending: (n: number) => `Reaching for box ${n}...`,
    granted: (n: number) => `Box ${n} is yours while this match burns.`,
    released: (n: number) => `Box ${n} is back on the shelf.`,
    holdEnded: (n: number) => `Your match went out. Box ${n} is back on the shelf.`,
    boxHeld: (n: number) => `Someone else is holding box ${n}. Choose another number.`,
    boxTaken: (n: number) => `Box ${n} has already found a home. Choose another number.`,
    holdNotYours: 'This hold belongs to someone else.',
  },
  banner: {
    salesPaused: 'Sales are paused because the shelf cannot be reached. The tale is still here.',
    editionClosed: 'This edition closed on 1 February 2027.',
  },
  payment: {
    started: 'Asking your bank...',
    challenge: 'Your bank wants to check it is you.',
    authorised: 'Your card is authorised. You have not been charged yet.',
    captured: 'Your card has been charged.',
    partiallyRefunded: 'Part of your payment has been refunded.',
    refunded: 'Your payment has been refunded.',
    voided: 'This authorisation was cancelled. You have not been charged.',
    authorisedTooLate: 'Your match went out before the bank replied. You have not been charged.',
    captureFailed: 'We could not charge your card. The press will be in touch.',
    authorisationExpired: 'This authorisation lapsed. You have not been charged.',
    pending: 'Waiting for your bank transfer.',
    settled: 'Your transfer has arrived.',
    lapsed: (n: number) => `Your transfer deadline passed. Box ${n} is back on the shelf.`,
  },
  declines: {
    do_not_honor: 'Your bank declined this card. Try another card; your match keeps burning.',
    insufficient_funds: 'This card has too little in it. Try another card; your match keeps burning.',
    expired_card: 'This card has expired. Try another card; your match keeps burning.',
    challenge_failed: 'The bank could not confirm it was you. Try again; your match keeps burning.',
    challenge_cancelled: "You cancelled the bank's check. Try again; your match keeps burning.",
    challenge_expired: "The bank's check ran out of time. Try again; your match keeps burning.",
  },
  fields: {
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
  },
  lookup: {
    refused: 'We could not find an order with that reference and email.',
    limited: 'Too many tries. Please wait before trying again.',
    certificatePending: 'Your certificate is being prepared.',
    certificateCancelled: 'This certificate was cancelled when the box was refunded.',
  },
  staff: {
    packingStarted: (n: number) => `Packing box ${n}...`,
    packed: (n: number) => `Box ${n} is packed.`,
    shipped: (n: number) => `Box ${n} is shipped.`,
    captureRefused: (n: number) => `The card could not be captured for box ${n}. Try packing again.`,
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
  },
  errors: {
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
    lookup_refused: 'We could not find an order with that reference and email.',
    lookup_limited: 'Too many tries. Please wait before trying again.',
    certificate_pending: 'Your certificate is being prepared.',
    certificate_cancelled: 'This certificate was cancelled when the box was refunded.',
    search_unreachable: 'Search is resting. The tale and the shelf still work.',
    queue_unreachable: 'The dead-letter list cannot be read right now. Nothing is lost.',
    pdf_unreachable: 'The PDF service is down. No statement was issued; try again shortly.',
    deliveries_unreachable: 'Delivery state cannot be read right now. Events are kept and will be sent.',
    identity_unreachable: 'Sign-in is unavailable right now. Try again shortly.',
  },
  outage: {
    gatewayCheckout: "The bank's line is down. Your match keeps burning; try again in a moment.",
    ledgerCheckout: "We can't record payments right now. Your match keeps burning; try again in a moment.",
    gatewayPack: 'The gateway is down. Nothing was captured.',
    ledgerPack: 'The ledger is down. Nothing was captured.',
    gatewayRefund: 'The gateway is down. No refund was started.',
    ledgerRefund: 'The ledger is down. No refund was started.',
    storageDownload: 'Downloads are unavailable right now. Try again shortly.',
    storageUpload: 'Plate storage is down. Nothing was saved; try again shortly.',
  },
} as const;

/** Per-code copy for codes whose strings reuse the published lines above. */
export function errorCopy(code: string): string {
  switch (code) {
    case 'box_held':
      return 'Someone else is holding this box. Choose another number.';
    case 'box_taken':
      return 'This box has already found a home. Choose another number.';
    case 'edition_closed':
      return 'This edition closed on 1 February 2027.';
    case 'hold_ended':
      return 'Your match went out. This box is back on the shelf.';
    case 'challenge_expired':
      return copy.declines.challenge_expired;
    case 'authorised_too_late':
      return copy.payment.authorisedTooLate;
    case 'capture_refused':
      return 'The card could not be captured. Try packing again.';
    case 'sales_paused':
      return copy.banner.salesPaused;
    case 'gateway_unreachable':
      return 'The gateway cannot be reached right now.';
    case 'ledger_unreachable':
      return 'The ledger cannot be reached right now.';
    case 'storage_unreachable':
      return 'Storage cannot be reached right now.';
    case 'lookup_refused':
      return copy.lookup.refused;
    case 'lookup_limited':
      return copy.lookup.limited;
    case 'certificate_pending':
      return copy.lookup.certificatePending;
    case 'certificate_cancelled':
      return copy.lookup.certificateCancelled;
    case 'do_not_honor':
    case 'insufficient_funds':
    case 'expired_card':
    case 'challenge_failed':
    case 'challenge_cancelled':
      return copy.declines[code as keyof typeof copy.declines];
    default:
      return (copy.errors as Record<string, string>)[code] ?? copy.errors.not_found;
  }
}
