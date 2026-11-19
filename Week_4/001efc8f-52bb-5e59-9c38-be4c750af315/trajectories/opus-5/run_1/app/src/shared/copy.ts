/** The published copy for every API error code and every field error. */

export const ERROR_MESSAGES = {
  payload_too_large: 'That request is larger than Rimewire accepts.',
  unsupported_media_type: 'Send JSON, or a form with photos.',
  unauthenticated: 'Your session has ended. Sign in again.',
  invalid_credentials: 'Email or password is incorrect.',
  not_found: 'That was not found.',
  forbidden: 'Your role cannot do that here.',
  cross_origin: 'Requests must come from Rimewire itself.',
  broadcast_only: 'Only dispatch, crew leads and operations post here. Reply in a thread instead.',
  client_message_id_conflict: 'That send id was already used for a different message.',
  message_deleted: 'That message was deleted.',
  rate_limited: 'You are sending faster than Rimewire accepts. Wait a moment, then use Retry send.',
  stale_version: 'Someone saved a newer version.',
  edit_window_closed: 'This message can no longer be edited.',
  already_pinned: 'That message is already pinned.',
  pin_limit: 'This channel has reached its pin limit. Unpin one first.',
  already_member: '',
  schedule_not_pending: 'This post has already gone out or was cancelled.',
  email_taken: 'That email cannot be invited.',
  cannot_deactivate_self: 'You cannot deactivate yourself.',
  validation: 'Check the highlighted fields.',
  storage_unavailable: 'Photo storage is unreachable. Text-only messages still send; try the photos again shortly.',
  internal_error: 'Something went wrong on our side. Try again.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function alreadyMemberMessage(name: string): string {
  return `${name} is already in this channel.`;
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
  filesTooMany: 'That is more photos than one message can carry.',
  expectedVersion: 'Editing needs the version you started from.',
  scheduleWhen: 'Pick a date and a time.',
  repeat: 'Choose no repeat or weekly.',
  qTooShort: 'Search for at least 2 characters.',
  qTooLong: 'Search for at most 200 characters.',
  qTooManyWords: 'Search for at most 8 words.',
  limit: 'Use a whole number of 1 or more.',
  before: 'That page link is no longer valid.',
  messageIds: 'Send between 1 and 100 message ids.',
  state: 'Use delivered or read.',
  userId: 'Pick a person.',
  pinMessageId: 'Pick a message from this channel.',
} as const;

export function fileWrongType(filename: string): string {
  return `${filename} is not a JPEG, PNG or WebP photo.`;
}

export function fileTooLarge(filename: string): string {
  return `${filename} is over the photo size limit.`;
}

export function fileTooManyPixels(filename: string): string {
  return `${filename} is over the 40-megapixel limit.`;
}

export function localTimePast(zone: string): string {
  return `That time has already passed in ${zone}.`;
}
