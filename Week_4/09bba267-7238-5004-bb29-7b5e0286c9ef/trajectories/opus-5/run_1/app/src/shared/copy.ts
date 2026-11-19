import { formatMoney } from './money';

/** Field messages answered with 422 validation errors. */
export const FIELD_MESSAGES = {
  idempotencyKey: 'Send an Idempotency-Key header of 1 to 100 visible characters.',
  seatIdsChoice: 'Choose between 1 and 8 different seats that are on sale for this performance.',
  seatIdsLimit: 'You can hold up to 8 seats for a performance.',
  name: 'Enter your full name.',
  email: 'Enter an email address like name@example.com.',
  newSeatId: 'Choose a different seat that is on sale for this performance.',
  ticketIds: 'Choose one or more different tickets from this order.',
  title: 'Enter a title of 1 to 120 characters.',
  startsLocalFormat: 'Enter the start as YYYY-MM-DDTHH:MM.',
  startsLocalNonexistent: 'That time does not occur in Chicago on that date.',
  startsLocalPast: 'The start must be in the future.',
  tiersCount: 'Add between 1 and 6 tiers.',
  tiersDetail:
    'Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses.',
} as const;

/** Announcements and notices, exact to the character. */
export const COPY = {
  seatTakenNotice: 'Someone else got there first. We kept the rest of your selection.',
  salesClosed: 'Sales for this performance have closed.',
  holdEnded: 'Your hold ended and the seats were released.',
  paymentConfirmed: 'Payment confirmed. Your tickets are issued.',
  checkoutDeclined: 'Your payment was declined. Your seats were released.',
  checkoutPaymentsPaused:
    'Payments are paused right now. Your seats stay held until your hold ends. Please try again shortly.',
  checkDetails: 'Check these details.',
  offerPaymentDeclined: 'Your payment was declined. The seat goes to the next person waiting.',
  offerPaymentsPaused:
    'Payments are paused right now. Your offer stays open until it ends. Please try again shortly.',
  offerEnded: 'This offer has ended.',
  offerEndedHeading: 'This offer has ended',
  offerDeclined: 'Offer declined. The seat goes to the next person waiting.',
  exchangeSeatTaken: 'That seat was just taken. Pick another seat.',
  exchangeDeclined: 'Your payment was declined. Your ticket is unchanged.',
  changePaymentsPaused: 'Payments are paused right now. Your ticket is unchanged. Please try again shortly.',
  changesClosed: 'Exchanges and refunds closed 24 hours before the performance.',
  ownerSignInFailed: 'That passcode is not right.',
  notFoundHeading: "We couldn't find that page",
  confirmationHeading: "You're in",
} as const;

export function heldAnnouncement(heldLabels: readonly string[], takenLabels: readonly string[]): string {
  if (takenLabels.length === 0) return `Held ${heldLabels.join(', ')}.`;
  if (heldLabels.length === 0) return `Taken by another buyer: ${takenLabels.join(', ')}.`;
  return `Held ${heldLabels.join(', ')}. Taken by another buyer: ${takenLabels.join(', ')}.`;
}

export function takenAnnouncement(labels: readonly string[]): string {
  return `Taken by another buyer: ${labels.join(', ')}.`;
}

export function releasedAnnouncement(label: string): string {
  return `Released ${label}.`;
}

export function receiptLine(email: string): string {
  return `A receipt is on its way to ${email}.`;
}

export function waitlistJoinedAnnouncement(tierName: string, position: number): string {
  return `You're on the waitlist for ${tierName}. Your place is ${position}.`;
}

export function alreadyWaitingAnnouncement(tierName: string): string {
  return `This email is already on the waitlist for ${tierName}.`;
}

export function tierNotSoldOutAnnouncement(tierName: string): string {
  return `Seats are still on sale in ${tierName}.`;
}

export function offerArrivedAnnouncement(label: string): string {
  return `A seat is offered to you: ${label}.`;
}

export function exchangeConfirmedAnnouncement(label: string): string {
  return `Exchange confirmed. Your new seat is ${label}.`;
}

export function refundConfirmedAnnouncement(amountCents: number): string {
  return `Refund confirmed: ${formatMoney(amountCents)}.`;
}

export function publishedAnnouncement(title: string): string {
  return `Published ${title}.`;
}
