export const ERROR_COPY = {
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: 'That password is wrong.' },
  code_invalid: { status: 401, message: 'That code is wrong or has expired.' },
  cross_origin: { status: 403, message: 'Requests must come from this site.' },
  not_found: { status: 404, message: "We couldn't find that page" },
  payload_too_large: { status: 413, message: 'That request is too large.' },
  file_too_large: { status: 413, message: 'That file is over the size limit for its type.' },
  idempotency_key_required: { status: 400, message: 'Send an Idempotency-Key header.' },
  request_in_progress: {
    status: 409,
    message: 'That request is still being processed. Try again in a moment.',
  },
  idempotency_conflict: {
    status: 409,
    message: 'That request key was already used for a different request.',
  },
  invalid_state: { status: 409, message: "This engagement can't do that at its current stage." },
  quote_locked: { status: 409, message: 'The quote is locked because the deposit is paid.' },
  quote_empty: { status: 409, message: 'Add at least one shot before paying the deposit.' },
  model_missing: { status: 409, message: "Upload your product's GLB file before paying the deposit." },
  measurement_pending: {
    status: 409,
    message: 'Your model is still being measured. Try again in a moment.',
  },
  unit_unconfirmed: {
    status: 409,
    message: 'Confirm the export unit of your model before paying the deposit.',
  },
  stills_missing: { status: 409, message: 'Post a still for every shot before sending for review.' },
  look_dev_unpaid: {
    status: 409,
    message: 'The look-dev invoice must be paid before final stills go out.',
  },
  finals_not_ready: { status: 409, message: "The final stills aren't ready for review yet." },
  invoice_not_payable: { status: 409, message: "This invoice can't be paid right now." },
  email_taken: {
    status: 409,
    message: 'That email already has a Gloamwork account. Sign in instead.',
  },
  slug_taken: { status: 409, message: 'That slug is already used by another case study.' },
  file_type_mismatch: {
    status: 422,
    message:
      "That file isn't what its name says. Upload a .glb, .step, .stp or .pdf file that matches its extension.",
  },
  gltf_malformed: {
    status: 422,
    message: "That GLB file couldn't be read. Re-export it as binary glTF 2.0 and upload it again.",
  },
  validation_failed: { status: 422, message: 'Check the highlighted fields.' },
  too_many_requests: {
    status: 429,
    message: 'Too many codes were requested. Try again in a few minutes.',
  },
  card_declined: {
    status: 402,
    message: 'Your card was declined. Nothing has been charged. Try another card.',
  },
  billing_unavailable: {
    status: 503,
    message: 'Billing is offline right now. Nothing has been charged. Please try again in a few minutes.',
  },
  storage_unavailable: {
    status: 503,
    message:
      'File storage is offline right now. Your file was not saved. Please try again in a few minutes.',
  },
  email_unavailable: {
    status: 503,
    message: 'Email is offline right now. Nothing has been charged. Please try again in a few minutes.',
  },
  content_unavailable: {
    status: 503,
    message: 'Studio content is offline right now. Please try again in a few minutes.',
  },
  search_unavailable: {
    status: 503,
    message: 'Search is offline right now. Please try again in a few minutes.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_COPY;

export const FIELD_COPY = {
  brand_name: 'Enter your brand name.',
  contact_name: 'Enter your name.',
  title: 'Enter a project title.',
  service_title: 'Use 1 to 60 characters.',
  email: 'Enter a valid email address.',
  currency_start: 'Choose EUR, GBP, USD or JPY.',
  currency_rate: 'Choose EUR, USD or JPY.',
  quantity: 'Choose between 1 and 6 colourways.',
  unit: 'Choose as exported, mm, cm or in.',
  unit_not_model: 'Only a GLB model has an export unit.',
  card_number: "Use one of the studio's test cards.",
  card_expiry: 'Enter an expiry date in the future.',
  card_cvc: 'Enter the 3-digit security code.',
  card_name: 'Enter the name on the card.',
  note: 'Describe what to change.',
  refund_minor: 'Enter a refund between 1 and the amount paid.',
  shot_code: "Choose a shot in this engagement's quote.",
  milestone: 'Choose look_dev or final_delivery.',
  rate: 'Enter a rate between 0.0001 and 1000 with up to four decimals.',
  effective_at: 'Enter a time that is now or later.',
  list_price_pence: 'Enter a whole number of pence from 1 to 10000000.',
  slug: 'Use 3 to 60 lowercase letters, digits and hyphens.',
  scene: 'Use 1 to 8 primitives and an accent of ember, cobalt or violet.',
  q: 'Use up to 100 characters.',
} as const;

export const NOT_FOUND_HEADING = "We couldn't find that page";
export const NOT_FOUND_TEXT = 'The link may have expired, been withdrawn, or never existed.';

export const MEASUREMENT_FAILED_COPY =
  "That GLB couldn't be measured. Re-export it as binary glTF 2.0 and upload it again.";

export const BANNER_COPY = {
  measuring:
    'Measuring is delayed. Your files are stored safely and will be measured when the queue is back.',
  documents:
    'Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.',
} as const;

export const SEARCH_EMPTY_COPY = 'Nothing in the studio matches that search.';
export const SCALE_EMPTY_COPY = 'Upload a GLB to see it at true scale.';
export const SIGNIN_SENT_COPY =
  'If that email belongs to a Gloamwork client, a sign-in code is on its way.';
