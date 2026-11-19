export const ERRORS = {
  not_signed_in: { status: 401, message: "Sign in first." },
  bad_credentials: { status: 401, message: "That email and password don't match." },
  unconfirmed: { status: 403, message: "Confirm your email to post postcards, pin notes and enter boards." },
  not_ranger: { status: 403, message: "Only rangers can do that." },
  not_host: { status: 403, message: "Only the host can do that." },
  own_photo: { status: 403, message: "You can't like your own photo." },
  bad_origin: { status: 403, message: "That request came from another site." },
  not_found: { status: 404, message: "Nothing here." },
  no_safari: { status: 404, message: "No safari with that code." },
  photo_too_large: { status: 413, message: "Photos can be at most <limit> bytes." },
  too_large: { status: 413, message: "That request is too large." },
  not_an_image: { status: 415, message: "Photos must be PNG or JPEG images." },
  out_of_film: { status: 409, message: "Out of film. Refill at Saltmarsh Harbour." },
  shot_key_reused: { status: 409, message: "That shot key was already used for another photo." },
  request_key_reused: { status: 409, message: "That request key was already used for something else." },
  email_taken: { status: 409, message: "That email already has an account." },
  safari_full: { status: 409, message: "That safari is full." },
  safari_ended: { status: 409, message: "That safari has ended." },
  own_safari: { status: 409, message: "You are the host of this safari." },
  note_decided: { status: 409, message: "Already <approved|declined> by <ranger name>." },
  note_not_approved: { status: 409, message: "Only an approved note can be removed." },
  not_at_harbour: { status: 409, message: "Refill film works only on Saltmarsh Harbour." },
  film_full: { status: 409, message: "Your film is already full." },
  tick_passed: { status: 422, message: "That moment has passed. Photo refused." },
  tick_ahead: { status: 422, message: "That moment hasn't happened yet. Photo refused." },
  cannot_stand: { status: 422, message: "No one could stand there. Photo refused." },
  camera_too_far: { status: 422, message: "The camera was too far from the explorer. Photo refused." },
  nothing_in_frame: { status: 422, message: "No creature in frame. Photo refused." },
  bad_pose: { status: 422, message: "That photo's details aren't valid." },
  not_land: { status: 422, message: "That tile isn't land." },
  bad_name: { status: 422, message: "Enter a name of 1 to 40 characters." },
  bad_email: { status: 422, message: "Enter a valid email address." },
  bad_password: { status: 422, message: "Use a password of at least 8 characters." },
  bad_code: { status: 422, message: "That code isn't right." },
  code_expired: { status: 422, message: "That code has expired. Send a new code." },
  note_empty: { status: 422, message: "Write a note first." },
  note_too_long: { status: 422, message: "Notes can be at most 140 characters." },
  bad_reason: { status: 422, message: "Choose a reason." },
  line_empty: { status: 422, message: "Write a line for your postcard." },
  line_too_long: { status: 422, message: "Postcard lines can be at most 140 characters." },
  caption_too_long: { status: 422, message: "Captions can be at most 140 characters." },
  hall_full: { status: 422, message: "A hall holds 12 photos." },
  wrong_island: { status: 422, message: "That photo wasn't taken on this island." },
  bad_request: { status: 422, message: "That request isn't valid." },
  postcard_limit: { status: 429, message: "You can send <limit> postcards an hour. Try again later." },
  storage_unavailable_photo: { status: 503, message: "Storage unreachable. Photo not kept, and your frame is still on the roll." },
  storage_unavailable_postcard: { status: 503, message: "Storage unreachable. Postcard not sent." },
  storage_unavailable_image: { status: 503, message: "Storage unreachable. Photo not available." },
  mail_unavailable_postcard: { status: 503, message: "Mail unreachable. Postcard not sent." },
  mail_unavailable_code: { status: 503, message: "Mail unreachable. No code sent." },
  database_unavailable: { status: 503, message: "The islands are unreachable. Try again soon." }
} as const;

export type ErrorCode = keyof typeof ERRORS;

export function errorMessage(code: ErrorCode, params?: Record<string, string | number>): string {
  let m: string = ERRORS[code].message;
  if (params) {
    for (const [k, v] of Object.entries(params)) m = m.replaceAll(`<${k}>`, String(v));
  }
  return m;
}

export function errorStatus(code: ErrorCode): number {
  return ERRORS[code].status;
}

/** Every failure of the API carries this single shape. */
export function errorBody(code: ErrorCode, params?: Record<string, string | number>): { error: ErrorCode; message: string } {
  return { error: code, message: errorMessage(code, params) };
}
