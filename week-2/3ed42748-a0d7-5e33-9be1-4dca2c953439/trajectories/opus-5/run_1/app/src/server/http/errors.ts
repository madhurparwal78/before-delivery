export type FieldReason =
  | 'required'
  | 'invalid'
  | 'too_long'
  | 'out_of_range'
  | 'too_far'
  | 'unknown_field'
  | 'not_png'
  | 'trailing_data'
  | 'animated'
  | 'bad_dimensions'
  | 'bad_image_data'
  | 'unknown_resident'
  | 'fixed_after_create'
  | 'in_past'
  | 'nonexistent_time';

export type FieldReasons = Record<string, FieldReason>;

/** The single error shape every API refusal takes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  readonly fields: FieldReasons | null;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    sentence: string,
    options: { fields?: FieldReasons; headers?: Record<string, string> } = {},
  ) {
    super(`${code}: ${sentence}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.sentence = sentence;
    this.fields = options.fields ?? null;
    this.headers = options.headers ?? {};
  }

  body(): unknown {
    const error: Record<string, unknown> = { code: this.code, message: this.sentence };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

const sentences: Record<string, string> = {
  cross_origin: 'This request came from somewhere else.',
  too_large: 'That request body is too large.',
  unsupported_media_type: 'That content type is not accepted here.',
  unauthenticated: 'This postbox needs a session.',
  not_found: 'Nothing was found here.',
  method_not_allowed: 'That method is not allowed here.',
  ticket_conflict: 'That ticket was already used for something else.',
  precondition_required: 'Name the revision this change was made from.',
  stale_revision: 'This mission changed since that revision.',
  validation: 'Some fields need another look.',
  internal: 'Something went wrong on Bramble.',
  sign_in_required: 'Claim your save first.',
  staff_only: 'Only staff can do that.',
  founder_only: 'Only the founder can do that.',
  cannot_moderate_staff: 'Staff cannot be moderated.',
  name_locked: 'That name cannot be changed right now.',
  not_owned: 'That satchel is not owned yet.',
  already_owned: 'That satchel is already owned.',
  insufficient_stamps: 'There are not enough stamps for that.',
  mission_not_live: 'That errand is no longer posted.',
  rush_claim_required: 'Rush parcels are claimed from the board.',
  hands_full: 'There is already a parcel in hand.',
  parcel_taken: 'Another courier got there first.',
  board_closed: 'That board has closed for the day.',
  parcel_closed: 'That parcel is already closed.',
  parcel_dropped: 'That parcel was dropped.',
  already_delivered: 'That parcel was already delivered.',
  hold_expired: 'That rush hold has run out.',
  already_muted: 'That courier is already muted.',
  not_muted: 'That courier is not muted.',
  illegal_transition: 'That mission cannot move that way.',
  mission_retired: 'Retired missions cannot be edited.',
  postbox_full: 'That postbox is full.',
  mail_limit: 'That is a lot of postcards for one window.',
  link_invalid: 'That postbox key does not fit any postbox.',
  link_expired: 'That postbox key has expired.',
  link_used: 'That postbox key was already used.',
  darkroom_closed: 'The darkroom is closed.',
  post_office_closed: 'The post office is closed.',
};

const statuses: Record<string, number> = {
  cross_origin: 403,
  too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  not_found: 404,
  method_not_allowed: 405,
  ticket_conflict: 409,
  precondition_required: 428,
  stale_revision: 412,
  validation: 422,
  internal: 500,
  sign_in_required: 403,
  staff_only: 403,
  founder_only: 403,
  cannot_moderate_staff: 403,
  name_locked: 403,
  not_owned: 409,
  already_owned: 409,
  insufficient_stamps: 409,
  mission_not_live: 409,
  rush_claim_required: 409,
  hands_full: 409,
  parcel_taken: 409,
  board_closed: 409,
  parcel_closed: 409,
  parcel_dropped: 409,
  already_delivered: 409,
  hold_expired: 409,
  already_muted: 409,
  not_muted: 409,
  illegal_transition: 409,
  mission_retired: 409,
  postbox_full: 409,
  mail_limit: 429,
  link_invalid: 410,
  link_expired: 410,
  link_used: 410,
  darkroom_closed: 503,
  post_office_closed: 503,
};

/** Builds a refusal from its code, which fixes both the status and the sentence. */
export function fail(
  code: keyof typeof statuses | string,
  options: { fields?: FieldReasons; headers?: Record<string, string>; sentence?: string } = {},
): ApiError {
  const status = statuses[code];
  const sentence = options.sentence ?? sentences[code];
  if (status === undefined || sentence === undefined) {
    throw new Error(`Unknown error code ${code}`);
  }
  return new ApiError(status, code, sentence, options);
}

export function validation(fields: FieldReasons): ApiError {
  return fail('validation', { fields });
}

export const notFound = (): ApiError => fail('not_found');
export const internalError = (): ApiError => fail('internal');
