export type ErrorCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'cross_origin'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'broadcast_only'
  | 'client_message_id_conflict'
  | 'message_deleted'
  | 'rate_limited'
  | 'stale_version'
  | 'edit_window_closed'
  | 'already_pinned'
  | 'pin_limit'
  | 'already_member'
  | 'schedule_not_pending'
  | 'email_taken'
  | 'cannot_deactivate_self'
  | 'validation'
  | 'storage_unavailable'
  | 'internal_error';

export const ERROR_COPY: Record<ErrorCode, string> = {
  payload_too_large: 'That request is larger than Rimewire accepts.',
  unsupported_media_type: 'Send JSON, or a form with photos.',
  cross_origin: 'Requests must come from Rimewire itself.',
  unauthenticated: 'Your session has ended. Sign in again.',
  invalid_credentials: 'Email or password is incorrect.',
  not_found: 'That was not found.',
  forbidden: 'Your role cannot do that here.',
  broadcast_only: 'Only dispatch, crew leads and operations post here. Reply in a thread instead.',
  client_message_id_conflict: 'That send id was already used for a different message.',
  message_deleted: 'That message was deleted.',
  rate_limited: 'You are sending faster than Rimewire accepts. Wait a moment, then use Retry send.',
  stale_version: 'Someone saved a newer version.',
  edit_window_closed: 'This message can no longer be edited.',
  already_pinned: 'That message is already pinned.',
  pin_limit: 'This channel has reached its pin limit. Unpin one first.',
  already_member: '{name} is already in this channel.',
  schedule_not_pending: 'This post has already gone out or was cancelled.',
  email_taken: 'That email cannot be invited.',
  cannot_deactivate_self: 'You cannot deactivate yourself.',
  validation: 'Check the highlighted fields.',
  storage_unavailable: 'Photo storage is unreachable. Text-only messages still send; try the photos again shortly.',
  internal_error: 'Something went wrong on our side. Try again.',
};

/** One ApiError type for the whole API; every error body is built only here. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: Record<string, string> | null;
  readonly headers: Record<string, string>;
  extra?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    status?: number,
    fieldErrors?: Record<string, string> | null,
    headers?: Record<string, string>,
  ) {
    super(messageFor(code, fieldErrors ?? null));
    this.code = code;
    this.status = statusFor(code, status);
    this.fieldErrors = fieldErrors ?? null;
    this.headers = headers ?? {};
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: messageFor(this.code, this.fieldErrors) };
    if (this.code === 'validation' && this.fieldErrors) body.errors = this.fieldErrors;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

function messageFor(code: ErrorCode, fieldErrors: Record<string, string> | null): string {
  if (code === 'already_member' && fieldErrors && fieldErrors.name) {
    return ERROR_COPY.already_member.replace('{name}', fieldErrors.name);
  }
  return ERROR_COPY[code];
}

function statusFor(code: ErrorCode, status?: number): number {
  if (status !== undefined) return status;
  switch (code) {
    case 'payload_too_large':
      return 413;
    case 'unsupported_media_type':
      return 415;
    case 'cross_origin':
      return 403;
    case 'unauthenticated':
      return 401;
    case 'invalid_credentials':
      return 401;
    case 'not_found':
      return 404;
    case 'message_deleted':
      return 410;
    case 'broadcast_only':
    case 'forbidden':
      return 403;
    case 'rate_limited':
      return 429;
    case 'stale_version':
      return 412;
    case 'already_pinned':
    case 'pin_limit':
    case 'already_member':
    case 'schedule_not_pending':
    case 'email_taken':
    case 'cannot_deactivate_self':
    case 'edit_window_closed':
    case 'client_message_id_conflict':
      return 409;
    case 'validation':
      return 422;
    case 'storage_unavailable':
      return 503;
    default:
      return 500;
  }
}

export const FIELD_COPY = {
  unaccepted: 'This field cannot be set here.',
  email: 'Enter an email address.',
  passwordSignIn: 'Enter your password.',
  passwordJoin: 'Use 12 to 128 characters.',
  nameEmpty: 'Enter a name.',
  nameControl: 'Names cannot contain line breaks or control characters.',
  nameTooLong: 'Use at most 80 characters.',
  role: 'Pick a role.',
  textEmpty: 'Write a message or attach a photo.',
  textTooLong: 'This message is over the length limit.',
  clientMessageId: 'Sending needs a client message id in UUID form.',
  threadRootId: 'Reply to a top-level message in this channel.',
  quotedMessageId: 'Quote a message from this channel.',
  filesType: '{filename} is not a JPEG, PNG or WebP photo.',
  filesTooLarge: '{filename} is over the photo size limit.',
  filesTooManyPixels: '{filename} is over the 40-megapixel limit.',
  filesTooMany: 'That is more photos than one message can carry.',
  expectedVersion: 'Editing needs the version you started from.',
  localDateTime: 'Pick a date and a time.',
  localTimePast: 'That time has already passed in {zone}.',
  repeat: 'Choose no repeat or weekly.',
  qTooShort: 'Search for at least 2 characters.',
  qTooLong: 'Search for at most 200 characters.',
  qTooManyWords: 'Search for at most 8 words.',
  limit: 'Use a whole number of 1 or more.',
  before: 'That page link is no longer valid.',
  messageIds: 'Send between 1 and 100 message ids.',
  state: 'Use delivered or read.',
  userId: 'Pick a person.',
  messageIdPins: 'Pick a message from this channel.',
} as const;

export function fieldCopy(key: keyof typeof FIELD_COPY, params?: Record<string, string>): string {
  const template = FIELD_COPY[key];
  if (!params) return template;
  let out = template as string;
  for (const [k, v] of Object.entries(params)) out = out.replace(`{${k}}`, v);
  return out;
}
