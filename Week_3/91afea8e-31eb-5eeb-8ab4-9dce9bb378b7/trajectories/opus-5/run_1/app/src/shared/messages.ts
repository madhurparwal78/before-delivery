/** Published copy. Every API error body and live-region string is built from here. */

export type ErrorCode =
  | 'invalid_credentials'
  | 'invalid_code'
  | 'resend_too_soon'
  | 'too_many_codes'
  | 'sms_unavailable'
  | 'signed_out'
  | 'cod_seller'
  | 'cod_pincode'
  | 'cod_open_orders'
  | 'cod_over_cap'
  | 'sold_out'
  | 'price_changed'
  | 'payments_unavailable'
  | 'upi_unavailable'
  | 'netbanking_unavailable'
  | 'storage_unavailable'
  | 'document_pending'
  | 'label_pending'
  | 'payment_pending'
  | 'return_window_closed'
  | 'not_returnable'
  | 'link_not_found'
  | 'read_only'
  | 'rate_limited'
  | 'listing_quota'
  | 'file_too_large'
  | 'unsupported_type'
  | 'photo_limit'
  | 'invalid_transition'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'idempotency_key_reused'
  | 'idempotency_key_required'
  | 'cross_site_request'
  | 'too_large';

export type MessageParams = {
  seller?: string;
  pincode?: string;
  date?: string;
  state?: string;
  seconds?: number;
  kind?: 'photo' | 'certificate';
};

const TEMPLATES: Record<ErrorCode, string> = {
  invalid_credentials: 'That email or phone and password do not match.',
  invalid_code: 'That code is wrong or has expired.',
  resend_too_soon: 'Wait before asking for another code.',
  too_many_codes: 'Too many codes requested. Try again later.',
  sms_unavailable: "We can't send codes right now. Try again in a few minutes.",
  signed_out: 'Your session ended. Sign in again to continue.',
  cod_seller: "<seller> doesn't offer cash on delivery.",
  cod_pincode: "Cash on delivery isn't available at <pincode>.",
  cod_open_orders: 'You already have 3 cash-on-delivery orders on the way.',
  cod_over_cap: 'Cash on delivery is available up to ₹50,000.00 per order.',
  sold_out: "Someone just bought the last one. You haven't been charged.",
  price_changed: 'A price in your cart changed. Check the new total.',
  payments_unavailable: "Payments are down for a moment. You haven't been charged.",
  upi_unavailable: 'UPI is not responding. Choose another way to pay.',
  netbanking_unavailable: 'Net banking is not responding. Choose another way to pay.',
  storage_unavailable: 'Uploads are paused. Try again in a few minutes.',
  document_pending: 'Your invoice is being prepared. Check back in a minute.',
  label_pending: 'Label is being prepared. Packing can continue.',
  payment_pending: "Payment isn't confirmed yet.",
  return_window_closed: 'The return window for this item closed on <date>.',
  not_returnable: "This item can't be returned.",
  link_not_found: 'This link has expired or been replaced.',
  read_only: 'Shared links are read-only.',
  rate_limited: 'Too many tries. Wait <seconds> seconds.',
  listing_quota: 'You have 200 live listings. Unlist one to add another.',
  file_too_large: 'Photos can be up to 2,000,000 bytes.',
  unsupported_type: 'Photos must be JPEG, PNG or WebP.',
  photo_limit: 'A listing can have up to 6 photos.',
  invalid_transition: "That step isn't possible from <state> now.",
  forbidden: "Your role can't do that.",
  not_found: 'nothing here. wrong turn at the chauraha.',
  validation_failed: 'Check the highlighted fields.',
  idempotency_key_reused: 'This payment key was already used for a different order.',
  idempotency_key_required: 'Send an Idempotency-Key header.',
  cross_site_request: 'Request refused.',
  too_large: 'That request is too large.',
};

export function errorMessage(code: ErrorCode, params: MessageParams = {}): string {
  if (code === 'file_too_large' && params.kind === 'certificate') {
    return 'Certificates can be up to 5,000,000 bytes.';
  }
  if (code === 'unsupported_type' && params.kind === 'certificate') {
    return 'Certificates must be PDF, JPEG or PNG.';
  }
  let out = TEMPLATES[code];
  if (params.seller !== undefined) out = out.replace('<seller>', params.seller);
  if (params.pincode !== undefined) out = out.replace('<pincode>', params.pincode);
  if (params.date !== undefined) out = out.replace('<date>', params.date);
  if (params.state !== undefined) out = out.replace('<state>', params.state);
  if (params.seconds !== undefined) out = out.replace('<seconds>', String(params.seconds));
  return out;
}

/** Field messages inside `errors`. */
export const FIELD = {
  tooShort: (label: string, min: number) => `${label} needs at least ${min} characters.`,
  tooLong: (label: string, max: number) => `${label} can be up to ${max} characters.`,
  unsettable: "This field can't be set.",
  quantityOverTen: 'You can buy up to 10 of this item.',
  quantityOverStock: "We don't have that many in stock.",
  cartLineLimit: 'Your cart can hold up to 10 lines. Save something for later first.',
  oneDayUnavailable: "One-day delivery isn't available for this parcel.",
  badCoupon: "That coupon isn't valid for this cart.",
  badGiftCard: "That gift card code isn't valid.",
  wrongCurrentPassword: 'That is not your current password.',
  refundTooLarge: (n: number) => `Only ${n} units can still be refunded.`,
  emiTooSmall: 'EMI starts at ₹3,000.00.',
  unknownCardNetwork: 'We accept Visa, Mastercard and RuPay cards.',
  badPincode: 'Enter a 6-digit pincode.',
  badPhone: 'Enter a 10-digit Indian mobile number.',
  badSearchLimit: 'Pages hold up to 24 results.',
  badOffersLimit: 'Up to 10 offers per page.',
} as const;

/** Copy that is not an error body. */
export const COPY = {
  codeSent: 'Enter the 6-digit code we sent to your phone.',
  codeMaybeSent: "If this number can be used, we'll text a 6-digit code to it.",
  passwordChanged: 'Password changed. Other devices are signed out.',
  noResults: 'no match. loosen a filter.',
  searchDegraded: 'Search is running in basic mode. Typo matching and filters are off for now.',
  compareOverFour: 'Compare up to 4 products.',
  compareMixedCategories: 'Compare products from one category.',
  compareUnderTwo: 'Pick at least 2 products.',
  codAvailable: 'Cash on delivery available.',
  soldOutLine: 'Sold out. Remove it or save it for later.',
  orderPlacedHeading: 'order placed.',
  waitingHeading: 'waiting for your payment.',
  paymentFailedHeading: "payment didn't go through. nothing was charged.",
  emptyCart: "your cart is empty. the bazaar isn't.",
  listingSaved: 'Listing saved.',
  heroHeading: 'everything. one cart.',
  allProducts: 'all products',
} as const;

export const MERGE_OUTCOME_COPY = {
  added: (title: string) => `${title}: added.`,
  combined: (title: string, n: number) => `${title}: combined, now ${n}.`,
  capped: (title: string) => `${title}: capped at 10.`,
  saved_for_later: (title: string) => `${title}: cart full, saved for later.`,
  unavailable: (title: string) => `${title}: no longer available.`,
} as const;

export type MergeOutcome = keyof typeof MERGE_OUTCOME_COPY;

export const pincodeNotServiceable = (pincode: string) => `We don't deliver to ${pincode} yet.`;
export const sellerCannotReach = (seller: string, pincode: string) =>
  `${seller} doesn't deliver to ${pincode}.`;
export const resultCount = (n: number) => (n === 1 ? '1 result' : `${n} results`);
export const cartTotalChange = (amount: string, parcels: number) =>
  `Total ${amount}, ${parcels === 1 ? '1 parcel' : `${parcels} parcels`}.`;
export const returnRequested = (amount: string) => `Return requested. Refund on pickup: ${amount}.`;
export const refundConfirmed = (amount: string, methodLabel: string) =>
  `Refunded ${amount} to ${methodLabel}.`;
export const refundPending = (amount: string) => `Refund of ${amount} is on its way.`;
export const stockSaved = (title: string, n: number) => `Stock saved: ${title}, ${n} units.`;
export const saveFailed = (message: string) => `Not saved: ${message}`;
export const parcelsOnTheWay = (n: number) =>
  n === 1 ? '1 parcel on the way.' : `${n} parcels on the way.`;
