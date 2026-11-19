import { formatAmount, formatPrice, longDate, monthLabel } from './format.js';
import type { MarketStatus, Plan } from './api.js';

/** Every published string lives here, word for word. */
export const COPY = {
  productName: 'Plumtide Venue',
  openTheBook: 'Open the book',
  sampleBook: 'Sample book',
  emptyBook: 'No resting orders yet — be the first on the book.',
  emptyStatements: 'No statements yet — your first arrives on the 1st.',
  signInExpiredHeading: 'Sign-in link expired',
  signInExpiredBody: 'Start again from Sign in.',
  signInUnavailableHeading: 'Sign-in is unavailable right now — try again in a minute.',
  noVenueHeading: 'No venue yet',
  noVenueBody: "Ask your venue's owner for an invite.",
  notFoundHeading: "We couldn't find that page",
  inviteExpired: 'This invite has expired — ask for a new one.',

  sendingOrder: 'Sending order…',
  orderResting: 'Order resting',
  filledInFull: 'Filled in full',
  partiallyFilled: (filled: number, quantity: number): string =>
    `Partially filled — ${filled} of ${quantity}`,
  filledAt: (kind: 'pair' | 'event', quantity: number, price: number): string =>
    `Filled ${quantity} at ${formatPrice(kind, price)}`,
  cancelling: 'Cancelling…',
  orderCancelled: 'Order cancelled',
  orderAlreadyEnded: 'This order has already ended.',
  marketNotTrading: "This market isn't trading right now.",
  liquidated: (symbol: string, kind: 'pair' | 'event', price: number): string =>
    `Your ${symbol} margin position was liquidated at ${formatPrice(kind, price)}.`,

  priceOutOfRangeEvent: 'Enter a price from 1¢ to 99¢.',
  priceOutOfRangePair: 'Enter a price from $0.01 to $10,000.00.',
  quantityOutOfRange: 'Enter a quantity from 1 to 100,000.',
  insufficientFunds: 'Not enough available balance for this order.',
  insufficientHoldings: "You don't hold enough units to sell.",
  exceedsPosition: 'This would flip your margin position — close it first.',

  depositPending: 'Waiting for card confirmation…',
  depositConfirmed: (amountCents: number): string =>
    `Deposit confirmed — ${formatAmount(amountCents)} added to your balance.`,
  depositAmountError: 'Enter an amount from $5.00 to $5,000.00.',
  depositCardError: 'Enter a valid card number.',
  depositDeclined: 'Card declined — nothing was charged.',
  paymentsPaused: 'Card payments are paused — your balance is safe',

  refundPending: 'Sending refund…',
  refundIssued: (amountCents: number): string => `Refund of ${formatAmount(amountCents)} issued.`,
  refundExceeds: (refundableCents: number): string =>
    `Enter an amount up to ${formatAmount(refundableCents)}.`,

  planPending: 'Updating plan…',
  planUpdated: (plan: Plan): string => `Plan updated to ${PLAN_LABELS[plan]}.`,
  planPendingChange: (plan: Plan, date: string): string =>
    `Changes to ${PLAN_LABELS[plan]} on ${longDate(date)}`,
  planLocked: 'Pay the outstanding balance before changing plan.',
  billingUnavailable: 'Billing is unavailable right now — your keys keep their current rate.',
  payPending: 'Sending payment…',
  paymentReceived: 'Payment received.',
  bannerPaymentFailed: 'Your last plan payment failed — pay now to keep your rate.',
  bannerDowngraded: 'Your plan is downgraded to Sandbox until the outstanding invoice is paid.',

  endpointPending: 'Saving endpoint…',
  endpointSaved: 'Endpoint saved.',
  endpointUrlError: 'Enter an http or https URL.',
  webhooksDelayed: 'Webhook delivery is delayed — your fills are safe and will be sent.',

  keyPending: 'Creating key…',
  keyShownOnce: 'This key is shown once.',
  keyNameError: 'Enter a key name of up to 40 characters.',

  statementsUnavailable: 'Statements are unavailable right now — try again in a few minutes.',
  generatingPending: 'Generating…',
  statementsGenerating: (month: string): string =>
    `Statements are being generated for ${monthLabel(month)}.`,
  monthNotClosed: 'Choose a month that has ended.',

  feesPending: 'Saving fees…',
  feesSaved: 'Fees saved.',
  feesError:
    'Enter whole basis points from 0 to 1,000, with the maker fee no higher than the taker fee.',

  invitePending: 'Sending invite…',
  inviteSent: (email: string): string => `Invite sent to ${email}.`,
  inviteEmailError: 'Enter a valid email.',
  inviteRolesError: 'Choose at least one role.',
  inviteDuplicate: 'That person is already a member.',
  identityUnavailable: 'Sign-in is unavailable right now — try again in a minute.',

  profilePending: 'Saving…',
  profileSaved: 'Profile saved.',
  profileNameError: 'Enter a display name of 1 to 60 characters.',
  uploadPending: 'Uploading…',
  documentUploaded: 'Document uploaded.',
  documentError: 'Upload a PDF, PNG or JPEG of up to 5,000,000 bytes.',
  documentsUnavailable: 'Documents are unavailable right now — try again in a few minutes.',
} as const;

export const PLAN_LABELS: Record<Plan, string> = {
  sandbox: 'Sandbox',
  builder: 'Builder',
  desk: 'Desk',
};

export const MARKET_STATUS_TEXT: Record<MarketStatus, string> = {
  listed: 'Listed',
  trading: 'Trading open',
  halted: 'Trading halted',
  closed: 'Trading closed',
  resolved: 'Resolved',
  settled: 'Settled',
};

/** `Resolved YES`, `Settled NO` and the rest of the market status texts. */
export function marketStatusText(status: MarketStatus, outcome: 'yes' | 'no' | null): string {
  if (status === 'resolved' || status === 'settled') {
    const label = status === 'resolved' ? 'Resolved' : 'Settled';
    return `${label} ${outcome === 'no' ? 'NO' : 'YES'}`;
  }
  return MARKET_STATUS_TEXT[status];
}

export const BILLING_STATE_BADGE = {
  active: 'Active',
  payment_failed: 'Payment failed',
  downgraded: 'Downgraded',
} as const;
