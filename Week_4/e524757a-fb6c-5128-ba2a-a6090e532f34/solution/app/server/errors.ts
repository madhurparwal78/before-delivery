/** The one error catalogue: every code, its status and its exact copy. Handlers throw `ApiError`; `http.ts` sends it. */

type Copy = string | ((detail: string) => string)

const CATALOGUE = {
  not_signed_in: [401, 'Sign in first.'],
  bad_credentials: [401, "That email and password don't match."],
  unconfirmed: [403, 'Confirm your email to post postcards, pin notes and enter boards.'],
  not_ranger: [403, 'Only rangers can do that.'],
  not_host: [403, 'Only the host can do that.'],
  own_photo: [403, "You can't like your own photo."],
  bad_origin: [403, 'That request came from another site.'],
  not_found: [404, 'Nothing here.'],
  no_safari: [404, 'No safari with that code.'],
  photo_too_large: [413, (limit: string) => `Photos can be at most ${Number(limit).toLocaleString('en-US')} bytes.`],
  too_large: [413, 'That request is too large.'],
  not_an_image: [415, 'Photos must be PNG or JPEG images.'],
  out_of_film: [409, 'Out of film. Refill at Saltmarsh Harbour.'],
  shot_key_reused: [409, 'That shot key was already used for another photo.'],
  request_key_reused: [409, 'That request key was already used for something else.'],
  email_taken: [409, 'That email already has an account.'],
  safari_full: [409, 'That safari is full.'],
  safari_ended: [409, 'That safari has ended.'],
  own_safari: [409, 'You are the host of this safari.'],
  note_decided: [409, (outcome: string) => `Already ${outcome}.`],
  note_not_approved: [409, 'Only an approved note can be removed.'],
  not_at_harbour: [409, 'Refill film works only on Saltmarsh Harbour.'],
  film_full: [409, 'Your film is already full.'],
  tick_passed: [422, 'That moment has passed. Photo refused.'],
  tick_ahead: [422, "That moment hasn't happened yet. Photo refused."],
  cannot_stand: [422, 'No one could stand there. Photo refused.'],
  camera_too_far: [422, 'The camera was too far from the explorer. Photo refused.'],
  nothing_in_frame: [422, 'No creature in frame. Photo refused.'],
  bad_pose: [422, "That photo's details aren't valid."],
  not_land: [422, "That tile isn't land."],
  bad_name: [422, 'Enter a name of 1 to 40 characters.'],
  bad_email: [422, 'Enter a valid email address.'],
  bad_password: [422, 'Use a password of at least 8 characters.'],
  bad_code: [422, "That code isn't right."],
  code_expired: [422, 'That code has expired. Send a new one.'],
  note_empty: [422, 'Write a note first.'],
  note_too_long: [422, 'Notes can be at most 140 characters.'],
  bad_reason: [422, 'Choose a reason.'],
  line_empty: [422, 'Write a line for your postcard.'],
  line_too_long: [422, 'Postcard lines can be at most 140 characters.'],
  caption_too_long: [422, 'Captions can be at most 140 characters.'],
  hall_full: [422, 'A hall holds 12 photos.'],
  wrong_island: [422, "That photo wasn't taken on this island."],
  bad_request: [422, "That request isn't valid."],
  postcard_limit: [429, (limit: string) => `You can send ${limit} postcards an hour. Try again later.`],
  storage_unavailable: [503, (variant: string) => STORAGE_COPY[variant] ?? ''],
  mail_unavailable: [503, (variant: string) => MAIL_COPY[variant] ?? ''],
  database_unavailable: [503, 'The islands are unreachable. Try again soon.'],
} as const satisfies Record<string, readonly [number, Copy]>

const STORAGE_COPY: Record<string, string> = {
  photo: 'Storage unreachable. Photo not kept, and your frame is still on the roll.',
  postcard: 'Storage unreachable. Postcard not sent.',
  image: 'Storage unreachable. Photo not available.',
}

const MAIL_COPY: Record<string, string> = {
  postcard: 'Mail unreachable. Postcard not sent.',
  code: 'Mail unreachable. No code sent.',
}

export type ErrorCode = keyof typeof CATALOGUE

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode

  /** `detail` fills the copy that varies: the photo limit, the note outcome, the storage or mail variant. */
  constructor(code: ErrorCode, detail = '', readonly headers: Record<string, string> = {}) {
    const [status, copy] = CATALOGUE[code] as readonly [number, Copy]
    super(typeof copy === 'string' ? copy : copy(detail))
    this.status = status
    this.code = code
  }

  get body(): { error: ErrorCode; message: string } {
    return { error: this.code, message: this.message }
  }
}
