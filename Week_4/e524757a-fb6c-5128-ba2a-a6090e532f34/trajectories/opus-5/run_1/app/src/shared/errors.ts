export type ErrorCode =
  | 'not_signed_in'
  | 'bad_credentials'
  | 'unconfirmed'
  | 'not_ranger'
  | 'not_host'
  | 'own_photo'
  | 'bad_origin'
  | 'not_found'
  | 'no_safari'
  | 'photo_too_large'
  | 'too_large'
  | 'not_an_image'
  | 'out_of_film'
  | 'shot_key_reused'
  | 'request_key_reused'
  | 'email_taken'
  | 'safari_full'
  | 'safari_ended'
  | 'own_safari'
  | 'note_decided'
  | 'note_not_approved'
  | 'not_at_harbour'
  | 'film_full'
  | 'tick_passed'
  | 'tick_ahead'
  | 'cannot_stand'
  | 'camera_too_far'
  | 'nothing_in_frame'
  | 'bad_pose'
  | 'not_land'
  | 'bad_name'
  | 'bad_email'
  | 'bad_password'
  | 'bad_code'
  | 'code_expired'
  | 'note_empty'
  | 'note_too_long'
  | 'bad_reason'
  | 'line_empty'
  | 'line_too_long'
  | 'caption_too_long'
  | 'hall_full'
  | 'wrong_island'
  | 'bad_request'
  | 'postcard_limit'
  | 'storage_unavailable'
  | 'mail_unavailable'
  | 'database_unavailable';

export type ErrorVariant = 'photo' | 'postcard' | 'image' | 'new_code';

const STATUS: Record<ErrorCode, number> = {
  not_signed_in: 401,
  bad_credentials: 401,
  unconfirmed: 403,
  not_ranger: 403,
  not_host: 403,
  own_photo: 403,
  bad_origin: 403,
  not_found: 404,
  no_safari: 404,
  photo_too_large: 413,
  too_large: 413,
  not_an_image: 415,
  out_of_film: 409,
  shot_key_reused: 409,
  request_key_reused: 409,
  email_taken: 409,
  safari_full: 409,
  safari_ended: 409,
  own_safari: 409,
  note_decided: 409,
  note_not_approved: 409,
  not_at_harbour: 409,
  film_full: 409,
  tick_passed: 422,
  tick_ahead: 422,
  cannot_stand: 422,
  camera_too_far: 422,
  nothing_in_frame: 422,
  bad_pose: 422,
  not_land: 422,
  bad_name: 422,
  bad_email: 422,
  bad_password: 422,
  bad_code: 422,
  code_expired: 422,
  note_empty: 422,
  note_too_long: 422,
  bad_reason: 422,
  line_empty: 422,
  line_too_long: 422,
  caption_too_long: 422,
  hall_full: 422,
  wrong_island: 422,
  bad_request: 422,
  postcard_limit: 429,
  storage_unavailable: 503,
  mail_unavailable: 503,
  database_unavailable: 503,
};

const MESSAGES: Record<ErrorCode, string> = {
  not_signed_in: 'Sign in first.',
  bad_credentials: "That email and password don't match.",
  unconfirmed: 'Confirm your email to post postcards, pin notes and enter boards.',
  not_ranger: 'Only rangers can do that.',
  not_host: 'Only the host can do that.',
  own_photo: "You can't like your own photo.",
  bad_origin: 'That request came from another site.',
  not_found: 'Nothing here.',
  no_safari: 'No safari with that code.',
  photo_too_large: 'Photos can be at most <limit> bytes.',
  too_large: 'That request is too large.',
  not_an_image: 'Photos must be PNG or JPEG images.',
  out_of_film: 'Out of film. Refill at Saltmarsh Harbour.',
  shot_key_reused: 'That shot key was already used for another photo.',
  request_key_reused: 'That request key was already used for something else.',
  email_taken: 'That email already has an account.',
  safari_full: 'That safari is full.',
  safari_ended: 'That safari has ended.',
  own_safari: 'You are the host of this safari.',
  note_decided: 'Already <outcome> by <ranger name>.',
  note_not_approved: 'Only an approved note can be removed.',
  not_at_harbour: 'Refill film works only on Saltmarsh Harbour.',
  film_full: 'Your film is already full.',
  tick_passed: 'That moment has passed. Photo refused.',
  tick_ahead: "That moment hasn't happened yet. Photo refused.",
  cannot_stand: 'No one could stand there. Photo refused.',
  camera_too_far: 'The camera was too far from the explorer. Photo refused.',
  nothing_in_frame: 'No creature in frame. Photo refused.',
  bad_pose: "That photo's details aren't valid.",
  not_land: "That tile isn't land.",
  bad_name: 'Enter a name of 1 to 40 characters.',
  bad_email: 'Enter a valid email address.',
  bad_password: 'Use a password of at least 8 characters.',
  bad_code: "That code isn't right.",
  code_expired: 'That code has expired. Send a new one.',
  note_empty: 'Write a note first.',
  note_too_long: 'Notes can be at most 140 characters.',
  bad_reason: 'Choose a reason.',
  line_empty: 'Write a line for your postcard.',
  line_too_long: 'Postcard lines can be at most 140 characters.',
  caption_too_long: 'Captions can be at most 140 characters.',
  hall_full: 'A hall holds 12 photos.',
  wrong_island: "That photo wasn't taken on this island.",
  bad_request: "That request isn't valid.",
  postcard_limit: 'You can send <limit> postcards an hour. Try again later.',
  storage_unavailable: 'Storage unreachable.',
  mail_unavailable: 'Mail unreachable.',
  database_unavailable: 'The islands are unreachable. Try again soon.',
};

const STORAGE_COPY: Record<string, string> = {
  photo: 'Storage unreachable. Photo not kept, and your frame is still on the roll.',
  postcard: 'Storage unreachable. Postcard not sent.',
  image: 'Storage unreachable. Photo not available.',
};

const MAIL_COPY: Record<string, string> = {
  postcard: 'Mail unreachable. Postcard not sent.',
  new_code: 'Mail unreachable. No code sent.',
};

export function errorStatus(code: ErrorCode): number {
  return STATUS[code];
}

export type ErrorDetail = {
  limit?: number;
  outcome?: string;
  rangerName?: string;
  variant?: ErrorVariant;
  retryAfter?: number;
};

export function errorMessage(code: ErrorCode, detail: ErrorDetail = {}): string {
  if (code === 'storage_unavailable') return STORAGE_COPY[detail.variant ?? 'photo'];
  if (code === 'mail_unavailable') return MAIL_COPY[detail.variant ?? 'postcard'];
  let message = MESSAGES[code];
  if (detail.limit !== undefined) {
    const printed = code === 'photo_too_large' ? detail.limit.toLocaleString('en-GB') : String(detail.limit);
    message = message.replace('<limit>', printed);
  }
  if (detail.outcome !== undefined) message = message.replace('<outcome>', detail.outcome);
  if (detail.rangerName !== undefined) message = message.replace('<ranger name>', detail.rangerName);
  return message;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail: ErrorDetail = {},
  ) {
    super(errorMessage(code, detail));
  }

  get status(): number {
    return errorStatus(this.code);
  }

  body(): { error: ErrorCode; message: string } {
    return { error: this.code, message: this.message };
  }
}
