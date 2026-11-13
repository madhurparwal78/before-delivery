/**
 * One error shape and one copy table for the whole app. The UI and every API
 * response take their wording from here.
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

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
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
  allowance_exceeded: 409,
  export_finished: 409,
  export_not_ready: 409,
  link_expired: 410,
  link_revoked: 410,
  conflict: 412,
  too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  upload_refused: 422,
  rate_limited: 429,
  storage_unavailable: 503,
  queue_unavailable: 503,
};

export interface AllowanceCopyInput {
  export_minutes_used: number;
  export_minutes_allowance: number;
  storage_bytes_used: number;
  storage_bytes_allowance: number;
}

export function groupedNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

/** GB is bytes ÷ 1,000,000,000 with one decimal (halves up), shown without a decimal when whole. */
export function gigabytes(bytes: number): string {
  const tenths = Math.floor(bytes / 100000000 + 0.5);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0 ? groupedNumber(whole) : `${groupedNumber(whole)}.${decimal}`;
}

export function allowanceText(allowance: AllowanceCopyInput): string {
  return `Export minutes ${allowance.export_minutes_used} of ${allowance.export_minutes_allowance} · storage ${gigabytes(
    allowance.storage_bytes_used,
  )} of ${gigabytes(allowance.storage_bytes_allowance)} GB`;
}

export type ErrorParams = {
  unauthenticated: undefined;
  bad_credentials: undefined;
  not_found: undefined;
  method_not_allowed: undefined;
  unsupported_media_type: { expected: string };
  too_large: { limit: number };
  forbidden: undefined;
  validation: undefined;
  conflict: { winner: string; clip_name: string };
  blocked: { clip_name: string; reason: string };
  row_locked: { row_name: string };
  group_blocked: { clip_name: string; reason: string };
  undo_blocked: { clip_name: string; row_name: string };
  undo_missing: { clip_name: string };
  nothing_to_undo: undefined;
  nothing_to_redo: undefined;
  cut_name_taken: { cut_name: string };
  media_in_use: { file_name: string; projects: string[] };
  upload_incomplete: { missing: number[] };
  upload_refused: { file_name: string; reason: string };
  allowance_exceeded: AllowanceCopyInput;
  export_finished: { state: string };
  export_not_ready: undefined;
  link_expired: { owner_name: string };
  link_revoked: { owner_name: string };
  rate_limited: { seconds: number };
  storage_unavailable: undefined;
  queue_unavailable: undefined;
};

export function errorMessage<C extends ErrorCode>(code: C, params: ErrorParams[C]): string {
  switch (code) {
    case 'unauthenticated':
      return 'Sign in to continue.';
    case 'bad_credentials':
      return 'That email and password do not match.';
    case 'not_found':
      return 'Nothing here. It may have been removed or you may not have access.';
    case 'method_not_allowed':
      return 'This address does not accept that request.';
    case 'unsupported_media_type':
      return `Send this request as ${(params as ErrorParams['unsupported_media_type']).expected}.`;
    case 'too_large':
      return `This request is over ${(params as ErrorParams['too_large']).limit} bytes.`;
    case 'forbidden':
      return 'Your role on this project cannot do that.';
    case 'validation':
      return 'Check the highlighted fields.';
    case 'conflict': {
      const p = params as ErrorParams['conflict'];
      return `${p.winner} changed ${p.clip_name} first. Your change to it was not saved.`;
    }
    case 'blocked': {
      const p = params as ErrorParams['blocked'];
      return `${p.clip_name} cannot move: ${p.reason}.`;
    }
    case 'row_locked':
      return `${(params as ErrorParams['row_locked']).row_name} is locked.`;
    case 'group_blocked': {
      const p = params as ErrorParams['group_blocked'];
      return `The group cannot move: ${p.clip_name} ${p.reason}.`;
    }
    case 'undo_blocked': {
      const p = params as ErrorParams['undo_blocked'];
      return `Undo would overlap ${p.clip_name} on ${p.row_name}.`;
    }
    case 'undo_missing':
      return `Undo needs ${(params as ErrorParams['undo_missing']).clip_name}, which was removed.`;
    case 'nothing_to_undo':
      return 'Nothing to undo.';
    case 'nothing_to_redo':
      return 'Nothing to redo.';
    case 'cut_name_taken':
      return `A cut called ${(params as ErrorParams['cut_name_taken']).cut_name} already exists.`;
    case 'media_in_use': {
      const p = params as ErrorParams['media_in_use'];
      return `${p.file_name} is used in ${p.projects.join(', ')}.`;
    }
    case 'upload_incomplete':
      return `Chunks still missing: ${(params as ErrorParams['upload_incomplete']).missing.join(', ')}.`;
    case 'upload_refused': {
      const p = params as ErrorParams['upload_refused'];
      return `Gatecut could not use ${p.file_name}: ${p.reason}.`;
    }
    case 'allowance_exceeded': {
      const p = params as ErrorParams['allowance_exceeded'];
      return `Allowance reached: export minutes ${p.export_minutes_used} of ${p.export_minutes_allowance} · storage ${gigabytes(
        p.storage_bytes_used,
      )} of ${gigabytes(p.storage_bytes_allowance)} GB.`;
    }
    case 'export_finished':
      return `This export already ended as ${(params as ErrorParams['export_finished']).state}.`;
    case 'export_not_ready':
      return 'The manifest is ready once the export is done.';
    case 'link_expired':
      return `This review link has expired. Ask ${(params as ErrorParams['link_expired']).owner_name} for a new one.`;
    case 'link_revoked':
      return `This review link was turned off. Ask ${(params as ErrorParams['link_revoked']).owner_name} for a new one.`;
    case 'rate_limited':
      return `This read token is over 30 requests in 10 seconds. Try again in ${
        (params as ErrorParams['rate_limited']).seconds
      } seconds.`;
    case 'storage_unavailable':
      return 'Media storage is unreachable. Uploads and exports are paused; nothing was saved.';
    case 'queue_unavailable':
      return 'The export queue is unreachable. No export was started and no minutes were used.';
  }
}

/** The blocker reasons: the <blocker reason>, the <reason> and the `reason` in `stopped`. */
export const BLOCKER = {
  inTheWay: (clipName: string): string => `${clipName} is in the way`,
  sourceStarts: 'the source starts there',
  sourceEnds: 'the source ends there',
  targetRowNotFree: 'the target row is not free',
  lengthDoesNotFit: 'the new length does not fit',
  rowLocked: (rowName: string): string => `${rowName} is locked`,
  timelineStarts: 'the timeline starts there',
} as const;

export const UPLOAD_REFUSAL = {
  unknownType: 'unknown file type',
  mp4Damaged: 'MP4 header is damaged',
  wavDamaged: 'WAV header is damaged',
  pngDamaged: 'PNG header is damaged',
  checksumMismatch: 'checksum does not match',
  replacementKind: 'replacement must be the same type',
  replacementShort: (projectTitle: string): string => `replacement is shorter than its use in ${projectTitle}`,
} as const;

export const FIELD_COPY = {
  title: 'Give the project a title of 1 to 80 characters.',
  frame_rate: 'Choose a frame rate from the list.',
  aspect_ratio: 'Choose an aspect ratio from the list.',
  cut_name: 'Name the cut in 1 to 60 characters.',
  reviewer_name: 'Add your name in 1 to 60 characters.',
  body: 'Notes are 1 to 2,000 characters.',
  mentions: 'A note can mention at most 5 people.',
  mention: (handle: string): string => `No one on this project is called @${handle}.`,
  text: 'Captions are 1 or 2 lines of at most 42 characters each.',
  q: 'Search is limited to 8 words and 200 characters.',
  limit: 'Page size must be 1 to 100.',
  cursor: 'This cursor is not valid.',
  file_name: 'File names are 1 to 120 characters with no slashes, control characters or leading dot.',
  email: 'No Gatecut account uses that email.',
  expires_in_seconds: 'Links last 10 to 2,592,000 seconds.',
  other: 'That value is not allowed here.',
} as const;

export const SRT_PROBLEM = {
  tooManyCues: 'This SRT file has more than 5,000 cues.',
  lineTooLong: (line: number): string => `Line ${line} is longer than 42 characters.`,
  tooManyLines: (cue: number): string => `Cue ${cue} has more than 2 text lines.`,
  malformedTime: (cue: number): string => `Cue ${cue} has a malformed time line.`,
  endsBeforeStart: (cue: number): string => `Cue ${cue} ends before it starts.`,
  shorterThanFrame: (cue: number): string => `Cue ${cue} is shorter than one frame.`,
  overlaps: (cue: number): string => `Cue ${cue} overlaps the cue before it.`,
  notUtf8: 'This file is not UTF-8 text.',
} as const;
