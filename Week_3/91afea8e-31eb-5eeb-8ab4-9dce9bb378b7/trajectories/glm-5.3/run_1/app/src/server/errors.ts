import type { IncomingMessage } from "node:http";

export interface ErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  retry_after?: number;
  [extra: string]: unknown;
}

// Every published copy, character for character.
export const copy = {
  stepOnePassed: "Enter the 6-digit code we sent to your phone.",
  codeSentGeneric: "If this number can be used, we'll text a 6-digit code to it.",
  invalidCredentials: "That email or phone and password do not match.",
  invalidCode: "That code is wrong or has expired.",
  resendTooSoon: "Wait before asking for another code.",
  tooManyCodes: "Too many codes requested. Try again later.",
  smsUnavailable: "We can't send codes right now. Try again in a few minutes.",
  signedOut: "Your session ended. Sign in again to continue.",
  passwordChanged: "Password changed. Other devices are signed out.",
  noResults: "no match. loosen a filter.",
  searchDegraded: "Search is running in basic mode. Typo matching and filters are off for now.",
  pincodeNotServiceable: (pin: string) => `We don't deliver to ${pin} yet.`,
  sellerCannotReach: (seller: string, pin: string) => `${seller} doesn't deliver to ${pin}.`,
  compareOver4: "Compare up to 4 products.",
  compareMixed: "Compare products from one category.",
  compareUnder2: "Pick at least 2 products.",
  cartTotal: (amount: string, parcels: number) => `Total ${amount}, ${parcels === 1 ? "1 parcel" : `${parcels} parcels`}.`,
  codAvailable: "Cash on delivery available.",
  codSeller: (seller: string) => `${seller} doesn't offer cash on delivery.`,
  codPincode: (pin: string) => `Cash on delivery isn't available at ${pin}.`,
  codOpenOrders: "You already have 3 cash-on-delivery orders on the way.",
  codOverCap: "Cash on delivery is available up to ₹50,000.00 per order.",
  soldOutLine: "Sold out. Remove it or save it for later.",
  soldOutCheckout: "Someone just bought the last one. You haven't been charged.",
  priceChanged: "A price in your cart changed. Check the new total.",
  paymentsUnavailable: "Payments are down for a moment. You haven't been charged.",
  upiUnavailable: "UPI is not responding. Choose another way to pay.",
  netbankingUnavailable: "Net banking is not responding. Choose another way to pay.",
  orderPlaced: (parcels: number) => `order placed.` + ` ${parcels === 1 ? "1 parcel" : `${parcels} parcels`} on the way.`,
  waitingPayment: "waiting for your payment.",
  paymentFailed: "payment didn't go through. nothing was charged.",
  emptyCart: "your cart is empty. the bazaar isn't.",
  documentPending: "Your invoice is being prepared. Check back in a minute.",
  labelPending: "Label is being prepared. Packing can continue.",
  paymentPendingPack: "Payment isn't confirmed yet.",
  returnWindowClosed: (date: string) => `The return window for this item closed on ${date}.`,
  notReturnable: "This item can't be returned.",
  returnRequested: (amount: string) => `Return requested. Refund on pickup: ${amount}.`,
  refundConfirmed: (amount: string, method: string) => `Refunded ${amount} to ${method}.`,
  refundPending: (amount: string) => `Refund of ${amount} is on its way.`,
  mergeAdded: (title: string) => `${title}: added.`,
  mergeCombined: (title: string, n: number) => `${title}: combined, now ${n}.`,
  mergeCapped: (title: string) => `${title}: capped at 10.`,
  mergeSavedForLater: (title: string) => `${title}: cart full, saved for later.`,
  mergeUnavailable: (title: string) => `${title}: no longer available.`,
  linkNotFound: "This link has expired or been replaced.",
  readOnly: "Shared links are read-only.",
  rateLimited: (seconds: number) => `Too many tries. Wait ${seconds} seconds.`,
  listingQuota: "You have 200 live listings. Unlist one to add another.",
  listingSaved: "Listing saved.",
  stockSaved: (title: string, n: number) => `Stock saved: ${title}, ${n} units.`,
  saveFailed: (message: string) => `Not saved: ${message}`,
  fileTooLargePhoto: "Photos can be up to 2,000,000 bytes.",
  fileTooLargeCertificate: "Certificates can be up to 5,000,000 bytes.",
  unsupportedPhoto: "Photos must be JPEG, PNG or WebP.",
  unsupportedCertificate: "Certificates must be PDF, JPEG or PNG.",
  photoLimit: "A listing can have up to 6 photos.",
  invalidTransition: (state: string) => `That step isn't possible from ${state} now.`,
  forbidden: "Your role can't do that.",
  notFound: "nothing here. wrong turn at the chauraha.",
  validationFailed: "Check the highlighted fields.",
  idempotencyKeyReused: "This payment key was already used for a different order.",
  idempotencyKeyRequired: "Send an Idempotency-Key header.",
  crossSiteRequest: "Request refused.",
  tooLarge: "That request is too large.",
  storageUnavailable: "Uploads are paused. Try again in a few minutes.",
  field: {
    minLength: (label: string, min: number) => `${label} needs at least ${min} characters.`,
    maxLength: (label: string, max: number) => `${label} can be up to ${max} characters.`,
    cantSet: "This field can't be set.",
    quantityOver10: "You can buy up to 10 of this item.",
    quantityOverStock: "We don't have that many in stock.",
    eleventhLine: "Your cart can hold up to 10 lines. Save something for later first.",
    oneDayUnavailable: "One-day delivery isn't available for this parcel.",
    badCoupon: "That coupon isn't valid for this cart.",
    badGiftCard: "That gift card code isn't valid.",
    wrongCurrentPassword: "That is not your current password.",
    supportRefundTooLarge: (n: number) => `Only ${n} units can still be refunded.`,
    emiTooSmall: "EMI starts at ₹3,000.00.",
    unknownNetwork: "We accept Visa, Mastercard and RuPay cards.",
    badPincode: "Enter a 6-digit pincode.",
    badPhone: "Enter a 10-digit Indian mobile number.",
    badPageSize: "Pages hold up to 24 results.",
    badOffersPageSize: "Up to 10 offers per page.",
  },
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors: Record<string, string> | null;
  readonly retryAfter: number | null;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, opts: { fields?: Record<string, string>; retryAfter?: number; extra?: Record<string, unknown> } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fieldErrors = opts.fields ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.extra = opts.extra ?? {};
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.fieldErrors) body.errors = this.fieldErrors;
    if (this.retryAfter !== null) body.retry_after = this.retryAfter;
    for (const [k, v] of Object.entries(this.extra)) body[k] = v;
    return body;
  }
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", copy.validationFailed, { fields });
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", copy.notFound);
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", copy.forbidden);
}

export function signedOut(): ApiError {
  return new ApiError(401, "signed_out", copy.signedOut);
}

export function invalidTransition(from: string, to: string): ApiError {
  return new ApiError(409, "invalid_transition", copy.invalidTransition(from), { extra: { from, to } });
}
