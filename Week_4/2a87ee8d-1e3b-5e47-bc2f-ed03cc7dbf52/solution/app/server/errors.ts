// The one error shape of the API, with every code the brief publishes.

const FIXED = {
  unauthenticated: [401, "Sign in to continue"],
  invalid_credentials: [401, "Email or password is incorrect"],
  session_ended: [401, "This join link is no longer active"],
  payment_required: [402, "Your workspace is read-only until the overdue payment is settled"],
  forbidden: [403, "You don't have permission to do that"],
  cross_origin: [403, "Cross-origin requests are not accepted"],
  not_found: [404, "Not found"],
  deadline_passed: [409, "Time is up for this round"],
  workshop_closed: [409, "This workshop has ended"],
  workshop_not_open: [409, "This workshop hasn't opened yet"],
  room_full: [409, "This room is full"],
  budget_exhausted: [409, "You have no dots left"],
  no_dot_to_return: [409, "You have no dot on that cluster"],
  op_conflict: [409, "That operation id was already used for a different change"],
  no_join_link: [409, "Create a join link first"],
  not_closed: [409, "The workshop isn't closed yet"],
  recap_not_ready: [409, "The recap files aren't stored yet"],
  plan_unchanged: [409, "You're already on that plan"],
  nothing_due: [409, "There's nothing to pay"],
  link_revoked: [410, "This join link has been turned off"],
  link_expired: [410, "This join link has expired"],
  too_large: [413, "That request is too large"],
  unsupported_media_type: [415, "That content type isn't accepted"],
  validation: [422, "Check the highlighted fields"],
  rate_limited: [429, "Too many requests — try again shortly"],
  quota_exceeded: [429, "You've reached today's invite limit"],
  storage_unavailable: [503, "File storage is unavailable"],
  billing_unavailable: [503, "Billing is unavailable"],
} as const;

type FixedCode = keyof typeof FIXED;
type ErrorCode = FixedCode | "plan_limit" | "illegal_transition" | "phase_locked";

export const FIELD = {
  unknownKey: "This field can't be set",
  clientOpId: "Send an operation id of 8 to 64 letters, digits, - or _",
  titleLength: "Enter a title of 1 to 120 characters",
  titleControl: "Titles can't contain line breaks or control characters",
  template: "Choose a template",
  scheduleFormat: "Enter a date and time as YYYY-MM-DDTHH:MM",
  endAfterStart: "The end must be after the start",
  sponsorEmail: "Enter an email address",
  fee: "Enter an amount in euros with up to two decimals",
  emailsEntry: "Every entry must be an email address",
  emailsCount: "Send between 1 and 30 addresses at a time",
  imageSide: "Images must be at most 8,000 pixels on each side",
  imageId: "Upload the image again",
  query: "Type between 1 and 100 characters",
  cursor: "That cursor isn't valid",
  freeAnnual: "Free has no annual term",
  other: "Check this value",
  gap: (zone: string) => `That time doesn't exist in ${zone} because the clocks go forward`,
} as const;

export type Fields = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    readonly code: ErrorCode,
    options: { message?: string; status?: number; fields?: Fields; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    const fixed = code in FIXED ? FIXED[code as FixedCode] : undefined;
    super(options.message ?? fixed?.[1] ?? code);
    this.status = options.status ?? fixed?.[0] ?? 409;
    this.extra = { ...(options.fields ? { fields: options.fields } : {}), ...options.extra };
    this.headers = options.headers ?? {};
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function fail(code: FixedCode, headers?: Record<string, string>): never {
  throw new ApiError(code, headers ? { headers } : {});
}

export function invalid(fields: Fields): never {
  throw new ApiError("validation", { fields });
}
