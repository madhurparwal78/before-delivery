// The one API error shape. Every refusal is an ApiError thrown from a check that runs in the
// brief's precedence order (413, 415, cross_origin, 401, 404, 403, replay/409/410, 429, 412,
// other 409, 422, 503); http.ts turns it into {"error","message"[,"errors"]}.

import { PHOTO_COPY } from "../shared/photoRules.js";

const COPY = {
  payload_too_large: [413, "That request is larger than Rimewire accepts."],
  unsupported_media_type: [415, "Send JSON, or a form with photos."],
  cross_origin: [403, "Requests must come from Rimewire itself."],
  unauthenticated: [401, "Your session has ended. Sign in again."],
  invalid_credentials: [401, "Email or password is incorrect."],
  not_found: [404, "That was not found."],
  forbidden: [403, "Your role cannot do that here."],
  broadcast_only: [403, "Only dispatch, crew leads and operations post here. Reply in a thread instead."],
  client_message_id_conflict: [409, "That send id was already used for a different message."],
  message_deleted: [410, "That message was deleted."],
  rate_limited: [429, "You are sending faster than Rimewire accepts. Wait a moment, then use Retry send."],
  stale_version: [412, "Someone saved a newer version."],
  edit_window_closed: [409, "This message can no longer be edited."],
  already_pinned: [409, "That message is already pinned."],
  pin_limit: [409, "This channel has reached its pin limit. Unpin one first."],
  already_member: [409, ""],
  schedule_not_pending: [409, "This post has already gone out or was cancelled."],
  email_taken: [409, "That email cannot be invited."],
  cannot_deactivate_self: [409, "You cannot deactivate yourself."],
  validation: [422, "Check the highlighted fields."],
  storage_unavailable: [503, "Photo storage is unreachable. Text-only messages still send; try the photos again shortly."],
  internal_error: [500, "Something went wrong on our side. Try again."],
} as const;

type ErrorCode = keyof typeof COPY;
export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, options: { message?: string; extra?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
    const [status, copy] = COPY[code];
    const message = options.message ?? copy;
    super(message);
    this.status = status;
    this.code = code;
    this.body = { error: code, message, ...options.extra };
    this.headers = options.headers ?? {};
  }
}

export function invalid(errors: FieldErrors): ApiError {
  return new ApiError("validation", { extra: { errors } });
}

export function alreadyMember(name: string): ApiError {
  return new ApiError("already_member", { message: `${name} is already in this channel.` });
}

// Field error copy (brief: Feedback states, field table).
export const FIELD = {
  unaccepted: "This field cannot be set here.",
  email: "Enter an email address.",
  passwordSignIn: "Enter your password.",
  passwordJoin: "Use 12 to 128 characters.",
  nameEmpty: "Enter a name.",
  nameControl: "Names cannot contain line breaks or control characters.",
  nameLong: "Use at most 80 characters.",
  role: "Pick a role.",
  textEmpty: "Write a message or attach a photo.",
  textLong: "This message is over the length limit.",
  clientMessageId: "Sending needs a client message id in UUID form.",
  threadRootId: "Reply to a top-level message in this channel.",
  quotedMessageId: "Quote a message from this channel.",
  filesTooMany: PHOTO_COPY.tooMany,
  expectedVersion: "Editing needs the version you started from.",
  dateTime: "Pick a date and a time.",
  repeat: "Choose no repeat or weekly.",
  qShort: "Search for at least 2 characters.",
  qLong: "Search for at most 200 characters.",
  qWords: "Search for at most 8 words.",
  limit: "Use a whole number of 1 or more.",
  before: "That page link is no longer valid.",
  messageIds: "Send between 1 and 100 message ids.",
  state: "Use delivered or read.",
  userId: "Pick a person.",
  pinMessageId: "Pick a message from this channel.",
  filesWrongType: PHOTO_COPY.wrongType,
  filesTooLarge: PHOTO_COPY.tooLarge,
  filesTooManyPixels: PHOTO_COPY.tooManyPixels,
  timePassed: (zone: string) => `That time has already passed in ${zone}.`,
} as const;
