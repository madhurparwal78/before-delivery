export type ErrorCode =
  | 'too_large'
  | 'cross_origin'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'role_ended'
  | 'outside_site_visit'
  | 'invalid_transition'
  | 'blocked'
  | 'awaiting_trade'
  | 'completion_photo_required'
  | 'bulk_failed'
  | 'items_not_verified'
  | 'job_closed'
  | 'already_member'
  | 'no_conflict'
  | 'visit_overlap'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'validation'
  | 'photo_too_large'
  | 'unsupported_image'
  | 'storage_unavailable';

const CATALOGUE: Record<ErrorCode, { status: number; message: string }> = {
  too_large: { status: 413, message: 'That request is too large.' },
  cross_origin: { status: 403, message: 'Requests must come from Snaglight itself.' },
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: "That email and password don't match." },
  not_found: { status: 404, message: 'Not found.' },
  forbidden: { status: 403, message: "You can't do that on this job." },
  role_ended: { status: 403, message: 'Your access to this job has ended.' },
  outside_site_visit: {
    status: 403,
    message: 'Access codes show from 30 minutes before your next site visit.',
  },
  invalid_transition: { status: 409, message: "That step isn't allowed from here." },
  blocked: { status: 409, message: 'Finish the items this one is waiting on first.' },
  awaiting_trade: { status: 409, message: "Waiting on the trade's completion photo." },
  completion_photo_required: {
    status: 409,
    message: 'Add a completion photo before marking this done.',
  },
  bulk_failed: { status: 409, message: 'None of the items changed.' },
  items_not_verified: { status: 409, message: 'Every item must be verified before close-out.' },
  job_closed: { status: 409, message: 'This job is closed out.' },
  already_member: { status: 409, message: 'That person already has a role on this job.' },
  no_conflict: { status: 409, message: 'That field has no conflict to resolve.' },
  visit_overlap: { status: 409, message: 'That person already has a visit then.' },
  nothing_to_undo: { status: 409, message: 'You have no edit to undo on this note.' },
  nothing_to_redo: { status: 409, message: 'You have no undone edit to redo on this note.' },
  validation: { status: 422, message: 'Check the highlighted fields.' },
  photo_too_large: { status: 413, message: 'Images must be 10,000,000 bytes or smaller.' },
  unsupported_image: { status: 415, message: 'Use a JPEG, PNG or WebP image.' },
  storage_unavailable: {
    status: 503,
    message: 'Storage is unreachable; nothing was saved. Try again shortly.',
  },
};

export const FIELD_MESSAGES = {
  pin: 'Drop the pin inside a room on the plan.',
  newPassword: 'New password must be at least 10 characters.',
  overlap: "Rooms can't overlap.",
  cycle: "Items can't wait on each other in a circle.",
  collinear: 'Pick three reference points that are not in a line.',
} as const;

export type ErrorBody = {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
} & Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}) {
    const entry = CATALOGUE[code];
    super(entry.message);
    this.status = entry.status;
    this.body = { error: code, message: entry.message, ...extra } as ErrorBody;
  }
}

export function fail(code: ErrorCode, extra: Record<string, unknown> = {}): never {
  throw new ApiError(code, extra);
}

export function failValidation(fields: Record<string, string>): never {
  throw new ApiError('validation', { fields });
}

export function errorBody(code: ErrorCode, extra: Record<string, unknown> = {}): ErrorBody {
  return { error: code, message: CATALOGUE[code].message, ...extra } as ErrorBody;
}

export function validationBody(fields: Record<string, string>): ErrorBody {
  return errorBody('validation', { fields });
}
