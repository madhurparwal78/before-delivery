// The one error shape, its fixed bodies and the sentences behind every code.

export type FieldReason =
  | "required"
  | "invalid"
  | "too_long"
  | "out_of_range"
  | "too_far"
  | "unknown_field"
  | "not_png"
  | "trailing_data"
  | "animated"
  | "bad_dimensions"
  | "bad_image_data"
  | "unknown_resident"
  | "fixed_after_create"
  | "in_past"
  | "nonexistent_time";

export type Fields = Record<string, FieldReason>;

const MESSAGES: Record<string, string> = {
  unauthenticated: "Start or restore a session first.",
  not_found: "Nothing was found here.",
  method_not_allowed: "That method isn't accepted here.",
  stale_revision: "This mission changed since you loaded it.",
  too_large: "That request is too large.",
  unsupported_media_type: "That content type isn't accepted here.",
  precondition_required: "Name the revision you edited with If-Match.",
  mail_limit: "You've mailed a lot of postcards. Try again later.",
  internal: "Something went wrong on Bramble.",
  validation: "Some fields need another look.",
  cross_origin: "Requests from other sites can't change anything here.",
  ticket_conflict: "That ticket was already used for a different request.",
  name_locked: "A community helper reset this name.",
  not_owned: "Buy this satchel first.",
  mission_not_live: "This errand is no longer posted.",
  rush_claim_required: "Rush parcels are claimed from the rush board.",
  hands_full: "Deliver or drop your parcel first.",
  sign_in_required: "Claim your save first.",
  parcel_taken: "Another courier got there first.",
  board_closed: "That board has closed for the day.",
  parcel_closed: "That parcel is already closed.",
  already_delivered: "That parcel was already delivered.",
  parcel_dropped: "That parcel was dropped.",
  hold_expired: "The rush hold ran out.",
  already_owned: "You already own this satchel.",
  insufficient_stamps: "Not enough stamps for this satchel.",
  post_office_closed: "The post office is closed.",
  darkroom_closed: "The darkroom is closed.",
  link_invalid: "This postbox key doesn't fit any postbox.",
  link_expired: "This postbox key has expired.",
  link_used: "This postbox key was already used.",
  postbox_full: "Your postbox is full.",
  staff_only: "Only community helpers and the founder can do this.",
  cannot_moderate_staff: "Helpers can't moderate staff.",
  already_muted: "This courier is already muted.",
  not_muted: "This courier isn't muted.",
  founder_only: "Only the founder can do this.",
  mission_retired: "Retired missions can't be edited.",
  illegal_transition: "That mission can't make that move.",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields?: Fields,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }

  body(): string {
    const error: Record<string, unknown> = { code: this.code, message: MESSAGES[this.code] ?? MESSAGES.internal };
    if (this.fields) error.fields = this.fields;
    return JSON.stringify({ error });
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found");
export const validation = (fields: Fields): ApiError => new ApiError(422, "validation", fields);
export const conflict = (code: string): ApiError => new ApiError(409, code);
export const forbidden = (code: string): ApiError => new ApiError(403, code);
export const INTERNAL_BODY = new ApiError(500, "internal").body();
