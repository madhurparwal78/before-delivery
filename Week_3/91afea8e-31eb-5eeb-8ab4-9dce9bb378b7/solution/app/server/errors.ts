import { rupees } from "../shared/format.js";
import { EMI_MINIMUM_PAISE } from "./domain/fees.js";

const MESSAGES = {
  signed_out: "Your session ended. Sign in again to continue.",
  invalid_credentials: "That email or phone and password do not match.",
  invalid_code: "That code is wrong or has expired.",
  resend_too_soon: "Wait before asking for another code.",
  too_many_codes: "Too many codes requested. Try again later.",
  sms_unavailable: "We can't send codes right now. Try again in a few minutes.",
  sold_out: "Someone just bought the last one. You haven't been charged.",
  price_changed: "A price in your cart changed. Check the new total.",
  payments_unavailable: "Payments are down for a moment. You haven't been charged.",
  upi_unavailable: "UPI is not responding. Choose another way to pay.",
  netbanking_unavailable: "Net banking is not responding. Choose another way to pay.",
  document_pending: "Your invoice is being prepared. Check back in a minute.",
  label_pending: "Label is being prepared. Packing can continue.",
  payment_pending: "Payment isn't confirmed yet.",
  not_returnable: "This item can't be returned.",
  link_not_found: "This link has expired or been replaced.",
  read_only: "Shared links are read-only.",
  listing_quota: "You have 200 live listings. Unlist one to add another.",
  photo_limit: "A listing can have up to 6 photos.",
  forbidden: "Your role can't do that.",
  not_found: "nothing here. wrong turn at the chauraha.",
  validation_failed: "Check the highlighted fields.",
  idempotency_key_reused: "This payment key was already used for a different order.",
  idempotency_key_required: "Send an Idempotency-Key header.",
  cross_site_request: "Request refused.",
  too_large: "That request is too large.",
  storage_unavailable: "Uploads are paused. Try again in a few minutes.",
  internal_error: "Something went wrong. Try again.",
  rate_limited: "",
  invalid_transition: "",
  return_window_closed: "",
  file_too_large: "",
  unsupported_type: "",
} as const;

type ErrorCode = keyof typeof MESSAGES;

interface MessageParams {
  seconds?: number;
  from?: string;
  date?: string;
  certificate?: boolean;
}

function messageFor(code: ErrorCode, params: MessageParams): string {
  switch (code) {
    case "rate_limited":
      return `Too many tries. Wait ${params.seconds} seconds.`;
    case "invalid_transition":
      return `That step isn't possible from ${params.from} now.`;
    case "return_window_closed":
      return `The return window for this item closed on ${params.date}.`;
    case "file_too_large":
      return params.certificate ? "Certificates can be up to 5,000,000 bytes." : "Photos can be up to 2,000,000 bytes.";
    case "unsupported_type":
      return params.certificate ? "Certificates must be PDF, JPEG or PNG." : "Photos must be JPEG, PNG or WebP.";
    default:
      return MESSAGES[code];
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly params: MessageParams = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** The one builder of every API error body. */
export function errorBody(error: ApiError): Record<string, unknown> {
  return { error: error.code, message: messageFor(error.code, error.params), ...error.extra };
}

export function validationFailed(errors: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", {}, { errors });
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found");
}

export function rateLimited(retryAfter: number): ApiError {
  return new ApiError(429, "rate_limited", { seconds: retryAfter }, { retry_after: retryAfter });
}

export function invalidTransition(from: string, to: string): ApiError {
  return new ApiError(409, "invalid_transition", { from }, { from, to });
}

export const FIELD = {
  cantSet: "This field can't be set.",
  quantityOverTen: "You can buy up to 10 of this item.",
  quantityOverStock: "We don't have that many in stock.",
  cartLines: "Your cart can hold up to 10 lines. Save something for later first.",
  savedLines: "Saved for later can hold up to 50 lines.",
  oneDayUnavailable: "One-day delivery isn't available for this parcel.",
  badCoupon: "That coupon isn't valid for this cart.",
  badGiftCard: "That gift card code isn't valid.",
  wrongCurrentPassword: "That is not your current password.",
  emiMinimum: `EMI starts at ${rupees(EMI_MINIMUM_PAISE)}.`,
  cardNetwork: "We accept Visa, Mastercard and RuPay cards.",
  badPincode: "Enter a 6-digit pincode.",
  badPhone: "Enter a 10-digit Indian mobile number.",
  searchPageSize: "Pages hold up to 24 results.",
  offersPageSize: "Up to 10 offers per page.",
  comparePick: "Pick at least 2 products.",
  compareOver: "Compare up to 4 products.",
  compareMixed: "Compare products from one category.",
  needsWholeNumber: "Enter a whole number.",
  needsText: "Enter some text.",
  badChoice: "Choose one of the listed values.",
  badCard: "Check the card number.",
  badExpiry: "Check the card expiry.",
  badCvv: "Enter the 3-digit CVV.",
  badUpi: "Enter a UPI ID like name@bank.",
  badBank: "Choose one of the listed banks.",
  badEmail: "Enter a valid email address.",
  badAddress: "Choose a delivery address.",
  badSavedCard: "Choose one of your saved cards.",
  emptyCart: "Select at least one item to check out.",
  badIdempotencyKey: "Use 8 to 64 letters, digits, - or _.",
  badJson: "Send a JSON body.",
  badIfsc: "Enter an 11-character IFSC code.",
  badAccountNumber: "Enter a 9 to 18 digit account number.",
  badDealPrice: "A deal price must be below the listing price.",
  badDealEnd: "A deal must end in the future.",
  badStock: "Stock must be a whole number from 0 to 9,999.",
  badPrice: "Enter a price in whole paise above zero.",
  badFile: "Send one file in the field named file.",
  noMethod: "Choose how to pay.",
  emiNeedsCard: "EMI needs a card.",
  emiNoBalance: "EMI can't be combined with Chauraha balance.",
  badTenure: "Choose 3, 6, 9 or 12 months.",
  listingNotOfProduct: "That listing belongs to another product.",
  wishlistFull: "A wishlist holds up to 100 items.",
  mergeTooMany: "Merge up to 20 lines at a time.",
  nameLength: (label: string, min: number, max: number, count: number) =>
    count < min ? `${label} needs at least ${min} characters.` : `${label} can be up to ${max.toLocaleString("en-US")} characters.`,
  refundUnits: (units: number) => `Only ${units} units can still be refunded.`,
  sellerNoPincode: (seller: string, pincode: string) => `${seller} doesn't deliver to ${pincode}.`,
  noPincode: (pincode: string) => `We don't deliver to ${pincode} yet.`,
} as const;
