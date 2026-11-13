import { inr, longDate } from "../shared/format";
import type { ApiErrorBody } from "../shared/api";

// Every API error is built here, in the one published shape.

const MESSAGES = {
  unauthenticated: [401, "Sign in to continue."],
  invalid_credentials: [401, "That email and password don't match."],
  not_found: [404, "We couldn't find that."],
  forbidden: [403, "You don't have permission to do that."],
  cross_origin: [403, "Requests must come from the Roam House site."],
  method_not_allowed: [405, "That action isn't allowed here."],
  idempotency_mismatch: [409, "This request was already used with different details. Start again."],
  stale_version: [412, "This record changed since you opened it. Reload to see the latest version."],
  reservation_expired: [409, "Your hold has ended and the items went back on sale. Press Pay to hold them again."],
  invalid_transition: [409, "That change isn't possible from the current status."],
  duplicate_request: [409, "There's already an open request for this item."],
  email_taken: [409, "An account with this email already exists."],
  unsupported_media_type: [415, "Send the request as JSON."],
  validation_failed: [422, "Check the highlighted fields."],
  not_eligible: [422, "This item isn't eligible for that request."],
  code_invalid: [422, "We don't recognise that code."],
  code_exhausted: [422, "This code has been fully used."],
  code_not_applicable: [422, "This code doesn't apply to anything in your bag."],
  card_declined: [402, "Your card was declined. No money was taken. Try another card."],
  insufficient_funds: [402, "Your card doesn't have enough funds. No money was taken. Try another card."],
  email_unavailable: [503, "We couldn't send your confirmation, so the order wasn't placed. Your bag is still held. Try again."],
  unsupported_file: [422, "Use a JPEG, PNG or WebP photo, or a PDF receipt."],
  unsupported_image: [422, "Use a JPEG, PNG or WebP image."],
  storage_unavailable_evidence: [503, "Evidence storage is unavailable. Nothing was saved. Try again."],
  storage_unavailable_image: [503, "Image storage is unavailable. Nothing was published. Try again."],
  too_large_request: [413, "This request is too large."],
  audit_immutable: [405, "Audit entries can't be changed."],
  server_error: [500, "Something went wrong on our side. Try again."],
} as const;

type Known = keyof typeof MESSAGES;

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

/** The published code of a message key: the two unsupported_file copies and the two storage copies share a code. */
function codeOf(key: Known): string {
  if (key === "unsupported_image") return "unsupported_file";
  if (key === "audit_immutable") return "method_not_allowed";
  if (key.startsWith("storage_unavailable")) return "storage_unavailable";
  if (key === "too_large_request") return "too_large";
  return key;
}

export function fail(key: Known): ApiError {
  const [status, message] = MESSAGES[key];
  return new ApiError(status, { error: codeOf(key), message });
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, { error: "validation_failed", message: MESSAGES.validation_failed[1], fields });
}

export function tooLargeFile(limit: number): ApiError {
  return new ApiError(413, { error: "too_large", message: `This file is larger than ${new Intl.NumberFormat("en-US").format(limit)} bytes.` });
}

/** The notice that comes with a line trimmed to what is left. */
export function clampNotice(available: number): string {
  return `Only ${available} left — we updated your bag.`;
}

export function outOfStock(variant: string, sku: string, available: number): ApiError {
  const message = available <= 0 ? `Sorry, the last ${variant} was just taken.` : clampNotice(available);
  return new ApiError(409, { error: "out_of_stock", message, sku, available });
}

export function alreadyRedeemed(balance: number): ApiError {
  return new ApiError(409, { error: "already_redeemed", message: `This gift card has already been used. Its balance is now ${inr(balance)}.` });
}

export function codeExpired(endsAt: Date): ApiError {
  return new ApiError(422, { error: "code_expired", message: `This code expired on ${longDate(endsAt)}.` });
}

export function minimumNotMet(shortfall: number): ApiError {
  return new ApiError(422, { error: "minimum_not_met", message: `Add ${inr(shortfall)} more to use this code.` });
}

export function windowClosed(kind: "return" | "trial", days: number, endedOn: Date): ApiError {
  const word = kind === "return" ? "return window" : "trial";
  return new ApiError(422, { error: "window_closed", message: `The ${days}-day ${word} ended on ${longDate(endedOn)}.` });
}

export function warrantyExpired(endedOn: Date): ApiError {
  return new ApiError(422, { error: "warranty_expired", message: `This item's warranty ended on ${longDate(endedOn)}.` });
}

export const FIELD = {
  email: "Enter an email address like name@example.com.",
  phone: "Enter a 10-digit mobile number.",
  name: "Enter the recipient's full name.",
  line1: "Enter the first line of the address.",
  line2: "Keep address line 2 to 100 characters or fewer.",
  city: "Enter a town or city.",
  state: "Choose a state.",
  postcode: "Enter a 6-digit PIN code.",
  label: "Give the address a label of 1 to 30 characters.",
  method: "Choose a shipping method.",
  giftMessage: "Keep the gift message to 200 characters or fewer.",
  cardNumber: "Enter a 16-digit card number.",
  cardExpiry: "Enter an expiry date in the future, as MM/YY.",
  cardCvc: "Enter the 3-digit security code.",
  accountName: "Enter your name in 1 to 80 characters.",
  password: "Use a password of at least 10 characters.",
  quantity: "Choose a quantity from 1 to 10.",
  sku: "Choose a variant from the catalogue.",
  code: "Enter a code.",
  cart: "Your bag is empty.",
  reason: "Choose a reason.",
  outcome: "Choose a refund or an exchange.",
  exchangeSku: "Choose another colour or size of the same bag at the same price.",
  note: "Keep the note to 500 characters or fewer.",
  component: "Choose the part that failed.",
  description: "Describe the fault in 20 to 1,000 characters.",
  evidenceIds: "Add 1 to 5 photos and at most one receipt.",
  evidenceKind: "Choose photo or receipt.",
  file: "Choose a file to upload.",
  rejectReason: "Give a reason of 5 to 500 characters.",
  price: "Enter a whole-rupee price from 1 to 9,99,999.",
  compareAt: "Enter a compare-at price above the price, or leave it empty.",
  available: "Enter a whole number of units from 0 to 9,999.",
  location: "Choose bhiwandi or gurugram.",
  productStatus: "Choose draft, published or archived.",
  orderStatus: "Choose packed, out for delivery, delivered or cancelled.",
  alt: "Write alt text of 5 to 160 characters.",
  colour: "Choose one of this product's colours.",
  carrier: "Choose a carrier.",
  tracking: "Use 6 to 30 capital letters, digits and hyphens.",
  lineIds: "Choose at least one line to ship.",
  caseTo: "Choose a status this case can move to.",
  promoCode: "Use 3 to 20 capital letters and digits.",
  promoExists: "That code already exists.",
  promoKind: "Choose percentage or fixed amount.",
  promoValue: "Enter a percentage from 1 to 90 or a fixed amount from ₹1 to ₹9,99,999.",
  promoCollection: "Choose a collection or every line.",
  promoMinimum: "Enter a minimum spend of ₹0 or more.",
  promoDate: "Enter a date and time.",
  promoEnds: "End after the start.",
  promoLimit: "Enter a usage limit of 1 or more, or leave it empty.",
  dateRange: "Enter a date as YYYY-MM-DD, with From on or before To.",
  airline: "Choose a listed airline.",
  fitSku: "Choose a luggage, backpack or tote variant.",
  idempotencyKey: "Send an Idempotency-Key of 8 to 128 characters.",
  setup: "Check this field.",
  step: "Choose a checkout step.",
} as const;
