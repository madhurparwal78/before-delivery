// The published error codes, their statuses and copy, and field error copy.

const CODES = {
  unauthenticated: [401, "Sign in to continue."],
  invalid_credentials: [401, "That password is wrong."],
  code_invalid: [401, "That code is wrong or has expired."],
  cross_origin: [403, "Requests must come from this site."],
  not_found: [404, "We couldn't find that page"],
  payload_too_large: [413, "That request is too large."],
  file_too_large: [413, "That file is over the size limit for its type."],
  idempotency_key_required: [400, "Send an Idempotency-Key header."],
  request_in_progress: [409, "That request is still being processed. Try again in a moment."],
  idempotency_conflict: [409, "That request key was already used for a different request."],
  invalid_state: [409, "This engagement can't do that at its current stage."],
  quote_locked: [409, "The quote is locked because the deposit is paid."],
  quote_empty: [409, "Add at least one shot before paying the deposit."],
  model_missing: [409, "Upload your product's GLB file before paying the deposit."],
  measurement_pending: [409, "Your model is still being measured. Try again in a moment."],
  unit_unconfirmed: [409, "Confirm the export unit of your model before paying the deposit."],
  stills_missing: [409, "Post a still for every shot before sending for review."],
  look_dev_unpaid: [409, "The look-dev invoice must be paid before final stills go out."],
  finals_not_ready: [409, "The final stills aren't ready for review yet."],
  invoice_not_payable: [409, "This invoice can't be paid right now."],
  email_taken: [409, "That email already has a Gloamwork account. Sign in instead."],
  slug_taken: [409, "That slug is already used by another case study."],
  file_type_mismatch: [422, "That file isn't what its name says. Upload a .glb, .step, .stp or .pdf file that matches its extension."],
  gltf_malformed: [422, "That GLB file couldn't be read. Re-export it as binary glTF 2.0 and upload it again."],
  validation_failed: [422, "Check the highlighted fields."],
  too_many_requests: [429, "Too many codes were requested. Try again in a few minutes."],
  card_declined: [402, "Your card was declined. Nothing has been charged. Try another card."],
  billing_unavailable: [503, "Billing is offline right now. Nothing has been charged. Please try again in a few minutes."],
  storage_unavailable: [503, "File storage is offline right now. Your file was not saved. Please try again in a few minutes."],
  email_unavailable: [503, "Email is offline right now. Nothing has been charged. Please try again in a few minutes."],
  content_unavailable: [503, "Studio content is offline right now. Please try again in a few minutes."],
  search_unavailable: [503, "Search is offline right now. Please try again in a few minutes."],
} as const satisfies Record<string, readonly [number, string]>;

type ErrorCode = keyof typeof CODES;

export const FIELD_COPY = {
  brand_name: "Enter your brand name.",
  contact_name: "Enter your name.",
  title_project: "Enter a project title.",
  title_service: "Use 1 to 60 characters.",
  email: "Enter a valid email address.",
  currency_start: "Choose EUR, GBP, USD or JPY.",
  currency_rate: "Choose EUR, USD or JPY.",
  quantity: "Choose between 1 and 6 colourways.",
  unit: "Choose as exported, mm, cm or in.",
  unit_non_glb: "Only a GLB model has an export unit.",
  card_number: "Use one of the studio's test cards.",
  card_expiry: "Enter an expiry date in the future.",
  card_cvc: "Enter the 3-digit security code.",
  card_name: "Enter the name on the card.",
  note: "Describe what to change.",
  refund_minor: "Enter a refund between 1 and the amount paid.",
  shot_code: "Choose a shot in this engagement's quote.",
  milestone: "Choose look_dev or final_delivery.",
  rate: "Enter a rate between 0.0001 and 1000 with up to four decimals.",
  effective_at: "Enter a time that is now or later.",
  list_price_pence: "Enter a whole number of pence from 1 to 10000000.",
  slug: "Use 3 to 60 lowercase letters, digits and hyphens.",
  scene: "Use 1 to 8 primitives and an accent of ember, cobalt or violet.",
  q: "Use up to 100 characters.",
  still_file: "Upload a PNG or JPEG still.",
  password: "Enter the studio password.",
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, fields?: Record<string, string>, headers: Record<string, string> = {}) {
    const [status, message] = CODES[code];
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  body(): { error: ErrorCode; message: string; fields?: Record<string, string> } {
    return this.fields ? { error: this.code, message: this.message, fields: this.fields } : { error: this.code, message: this.message };
  }
}

/** Collects field errors during validation and throws one `validation_failed` when any exist. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, copy: string): void {
    this.fields[field] ??= copy;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new ApiError("validation_failed", this.fields);
  }
}

export function invalid(field: string, copy: string): ApiError {
  return new ApiError("validation_failed", { [field]: copy });
}
