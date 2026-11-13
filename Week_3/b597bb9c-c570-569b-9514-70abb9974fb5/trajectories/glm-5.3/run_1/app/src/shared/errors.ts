/**
 * The one error copy table. Every API error body carries this copy as
 * `message`, and the UI shows the same copy.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'bad_credentials'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'too_large'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'blocked'
  | 'row_locked'
  | 'group_blocked'
  | 'undo_blocked'
  | 'undo_missing'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'cut_name_taken'
  | 'media_in_use'
  | 'upload_incomplete'
  | 'upload_refused'
  | 'allowance_exceeded'
  | 'export_finished'
  | 'export_not_ready'
  | 'link_expired'
  | 'link_revoked'
  | 'rate_limited'
  | 'storage_unavailable'
  | 'queue_unavailable';

export type FieldError =
  | 'title'
  | 'frame_rate'
  | 'aspect_ratio'
  | 'name'
  | 'body'
  | 'mentions'
  | 'mention'
  | 'text'
  | 'q'
  | 'limit'
  | 'cursor'
  | 'file_name'
  | 'email'
  | 'expires_in_seconds'
  | 'srt'
  | 'other';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  too_large: 413,
  forbidden: 403,
  validation: 422,
  conflict: 412,
  blocked: 409,
  row_locked: 409,
  group_blocked: 409,
  undo_blocked: 409,
  undo_missing: 409,
  nothing_to_undo: 409,
  nothing_to_redo: 409,
  cut_name_taken: 409,
  media_in_use: 409,
  upload_incomplete: 409,
  upload_refused: 422,
  allowance_exceeded: 409,
  export_finished: 409,
  export_not_ready: 409,
  link_expired: 410,
  link_revoked: 410,
  rate_limited: 429,
  storage_unavailable: 503,
  queue_unavailable: 503,
};

export const LIMIT_BYTES = 1_000_000;
export const CHUNK_BYTES = 5_242_880;
export const SRT_BYTES = 1_000_000;

export const API_ERROR_TEXT: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  bad_credentials: 'That email and password do not match.',
  not_found: 'Nothing here. It may have been removed or you may not have access.',
  method_not_allowed: 'This address does not accept that request.',
  unsupported_media_type: 'Send this request as {expected}.',
  too_large: 'This request is over {limit} bytes.',
  forbidden: 'Your role on this project cannot do that.',
  validation: 'Check the highlighted fields.',
  conflict: '{winner} changed {clip} first. Your change to it was not saved.',
  blocked: '{clip} cannot move: {reason}.',
  row_locked: '{row} is locked.',
  group_blocked: 'The group cannot move: {member} {reason}.',
  undo_blocked: 'Undo would overlap {clip} on {row}.',
  undo_missing: 'Undo needs {clip}, which was removed.',
  nothing_to_undo: 'Nothing to undo.',
  nothing_to_redo: 'Nothing to redo.',
  cut_name_taken: 'A cut called {name} already exists.',
  media_in_use: '{file} is used in {projects}.',
  upload_incomplete: 'Chunks still missing: {missing}.',
  upload_refused: 'Gatecut could not use {file}: {reason}.',
  allowance_exceeded:
    'Allowance reached: export minutes {used} of {allowance} · storage {usedGB} of {allowanceGB} GB.',
  export_finished: 'This export already ended as {state}.',
  export_not_ready: 'The manifest is ready once the export is done.',
  link_expired: 'This review link has expired. Ask {owner} for a new one.',
  link_revoked: 'This review link was turned off. Ask {owner} for a new one.',
  rate_limited: 'This read token is over 30 requests in 10 seconds. Try again in {n} seconds.',
  storage_unavailable: 'Media storage is unreachable. Uploads and exports are paused; nothing was saved.',
  queue_unavailable: 'The export queue is unreachable. No export was started and no minutes were used.',
};

export const FIELD_ERROR_TEXT: Record<FieldError, string> = {
  title: 'Give the project a title of 1 to 80 characters.',
  frame_rate: 'Choose a frame rate from the list.',
  aspect_ratio: 'Choose an aspect ratio from the list.',
  name: 'Name the cut in 1 to 60 characters.',
  body: 'Notes are 1 to 2,000 characters.',
  mentions: 'A note can mention at most 5 people.',
  mention: 'No one on this project is called @{handle}.',
  text: 'Captions are 1 or 2 lines of at most 42 characters each.',
  q: 'Search is limited to 8 words and 200 characters.',
  limit: 'Page size must be 1 to 100.',
  cursor: 'This cursor is not valid.',
  file_name: 'File names are 1 to 120 characters with no slashes, control characters or leading dot.',
  email: 'No Gatecut account uses that email.',
  expires_in_seconds: 'Links last 10 to 2,592,000 seconds.',
  srt: 'This SRT file is not valid.',
  other: 'That value is not allowed here.',
};

export function blockerText(code: string, p: Record<string, string>): string {
  switch (code) {
    case 'overlap': return `${p.other} is in the way`;
    case 'source_start': return 'the source starts there';
    case 'source_end': return 'the source ends there';
    case 'row_not_free': return 'the target row is not free';
    case 'length_does_not_fit': return 'the new length does not fit';
    case 'row_locked': return `${p.row} is locked`;
    case 'before_start': return 'the timeline starts there';
    default: return 'the timeline starts there';
  }
}

/** Copy for UI-only states and async feedback (not API errors). */
export const UI_TEXT = {
  signingIn: 'Signing in…',
  uploading: 'Uploading {file} — {percent}%',
  uploadAfterReload: '{file} — {percent}% · choose the file again to resume',
  inLibrary: '{file} is in the library.',
  alreadyInLibrary: '{file} is already in the library as {existing}.',
  stopped: 'Stopped at {timecode}: {reason}.',
  savingCut: 'Saving cut…',
  cutSaved: '{name} saved.',
  restoring: 'Restoring…',
  cutRestored: '{name} restored.',
  changingFrame: 'Changing frame…',
  frameChanged: 'The frame is now {ratio}.',
  makingLink: 'Making link…',
  linkReady: 'Review link ready. It works until {until}.',
  turningOffLink: 'Turning off link…',
  linkOff: 'Review link turned off.',
  pinning: 'Pinning…',
  notePinned: 'Note pinned at {timecode}.',
  approving: 'Approving…',
  cutApproved: '{name} approved.',
  startingExport: 'Starting export…',
  exportQueued: 'Export of {cut} at {size}p queued.',
  cancelling: 'Cancelling…',
  exportCancelled: 'Export cancelled.',
  readingSrt: 'Reading {file}…',
  captionsImported: '{n} captions imported into {row}.',
  makingToken: 'Making token…',
  tokenMade: 'Copy this token now; it will not be shown again.',
  sending: 'Sending…',
  commentSent: 'Comment sent.',
  roleChanged: 'Your role on {project} is now {role}.',
  removedFromProject: 'You no longer have access to {project}.',
  signedOut: 'You were signed out.',
  noProjects: 'No projects yet. Start one with New project.',
  noFiles: 'No files yet. Upload rushes to start the library.',
  noMatches: 'No files match {query}.',
  noNotes: 'No notes on this cut yet.',
  noExports: 'No exports yet.',
  noTokens: 'No read tokens yet.',
  outboxEmpty: 'The outbox is empty.',
  mailWaiting: 'Mail is waiting in the outbox: {n} messages.',
} as const;

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

export const ACTIVITY_TEXT = {
  move: '{name} moved {clip} to {timecode}.',
  trim: '{name} trimmed {clip}.',
  split: '{name} split {clip} at {timecode}.',
  remove: '{name} removed {clip}.',
  hide: '{name} hid {clip}.',
  show: '{name} showed {clip}.',
  shape: '{name} shaped {clip}.',
  restore: '{name} restored {cut}.',
  frame: '{name} changed the frame to {ratio}.',
  edit: '{name} edited the timeline.',
  note: '{name} pinned a note at {timecode}.',
  exportDone: 'Export of {cut} at {size}p is ready.',
  exportFailed: 'Export of {cut} at {size}p failed.',
  exportCancelled: 'Export of {cut} at {size}p was cancelled.',
  allowance: 'Allowance now: {allowance}.',
  cutShared: '{cut} is now shared for review.',
} as const;
