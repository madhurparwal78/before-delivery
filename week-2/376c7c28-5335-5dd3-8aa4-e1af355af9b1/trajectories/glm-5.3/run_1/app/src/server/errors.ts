// The single error body and precedence. ApiError carries the code and status; the
// dispatcher builds {"error":...,"message":...} (+ "errors" for validation, and
// any listed extra key) in exactly one place.

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, opts?: { fields?: Record<string, string>; extra?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = opts?.fields;
    this.extra = opts?.extra;
  }
}

export const notFound = (message = "Not found."): ApiError => new ApiError(404, "not_found", message);
export const forbidden = (message = "You may not do that."): ApiError => new ApiError(403, "forbidden", message);
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const conflict = (code: string, message: string, extra?: Record<string, unknown>): ApiError => new ApiError(409, code, message, { extra });
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation", "Fix the highlighted fields.", { fields });

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields && Object.keys(err.fields).length > 0) body.errors = err.fields;
  if (err.extra) Object.assign(body, err.extra);
  return body;
}

// Validation field messages, exactly as published.
export const fieldMsg = {
  title: "Enter a title of 1 to 80 characters.",
  clayBody: "Choose a clay body.",
  dimension: "Enter a number above 0 and up to 24 inches, with at most two decimals.",
  rate: "Enter whole cents from 1 to 100.",
  effectiveFrom: "Choose today or a later date.",
  effectiveTaken: "A rate schedule already starts on that date.",
  pickupWindow: "Enter whole days from 3 to 60.",
  storageFee: "Enter whole cents from 0 to 500.",
  amount: "Enter a non-zero amount up to $1,000.00 either way.",
  reason: "Enter a reason of 1 to 200 characters.",
  email: "Enter a valid email address.",
  role: "Choose a role.",
  handleFormat: "Use 3 to 24 lowercase letters, digits or hyphens.",
  handleTaken: "That handle is already used in this studio.",
  name: "Enter a name of 1 to 80 characters.",
  password: "Use 10 to 128 characters.",
  kilnFiring: "Choose a kiln and a firing.",
  deck: "That deck is no longer in this load.",
  loadStatus: "Choose loaded, firing, cooling or cancelled.",
  pieceFilter: "Choose a piece status.",
  unplacedFilter: "Use unplaced=1 or leave it out.",
  outcomes: "Give one outcome for every piece in the load.",
  month: "Choose a month.",
  day: "Choose a day.",
};
