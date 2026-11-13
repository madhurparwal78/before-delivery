import { timecode } from "./timecode";
import type { FrameRate } from "./rational";
import type { Allowance, OpSummary } from "./types";

type Params = Record<string, string | number>;

/** Every published error: its HTTP status and its copy, in one table. */
export const ERRORS = {
  unauthenticated: { status: 401, copy: () => "Sign in to continue." },
  bad_credentials: { status: 401, copy: () => "That email and password do not match." },
  not_found: { status: 404, copy: () => "Nothing here. It may have been removed or you may not have access." },
  method_not_allowed: { status: 405, copy: () => "This address does not accept that request." },
  unsupported_media_type: { status: 415, copy: (p: Params) => `Send this request as ${p.expected}.` },
  too_large: { status: 413, copy: (p: Params) => `This request is over ${p.limit} bytes.` },
  forbidden: { status: 403, copy: () => "Your role on this project cannot do that." },
  validation: { status: 422, copy: () => "Check the highlighted fields." },
  conflict: { status: 412, copy: (p: Params) => `${p.winner} changed ${p.clip} first. Your change to it was not saved.` },
  blocked: { status: 409, copy: (p: Params) => `${p.clip} cannot move: ${p.reason}.` },
  row_locked: { status: 409, copy: (p: Params) => `${p.row} is locked.` },
  group_blocked: { status: 409, copy: (p: Params) => `The group cannot move: ${p.member} ${p.reason}.` },
  undo_blocked: { status: 409, copy: (p: Params) => `Undo would overlap ${p.clip} on ${p.row}.` },
  undo_missing: { status: 409, copy: (p: Params) => `Undo needs ${p.clip}, which was removed.` },
  nothing_to_undo: { status: 409, copy: () => "Nothing to undo." },
  nothing_to_redo: { status: 409, copy: () => "Nothing to redo." },
  cut_name_taken: { status: 409, copy: (p: Params) => `A cut called ${p.cut} already exists.` },
  media_in_use: { status: 409, copy: (p: Params) => `${p.file} is used in ${p.projects}.` },
  upload_incomplete: { status: 409, copy: (p: Params) => `Chunks still missing: ${p.missing}.` },
  upload_refused: { status: 422, copy: (p: Params) => `Gatecut could not use ${p.file}: ${p.reason}.` },
  allowance_exceeded: {
    status: 409,
    copy: (p: Params) =>
      `Allowance reached: export minutes ${p.minutes} of ${p.minutes_allowance} · storage ${p.gb} of ${p.gb_allowance} GB.`,
  },
  export_finished: { status: 409, copy: (p: Params) => `This export already ended as ${p.state}.` },
  export_not_ready: { status: 409, copy: () => "The manifest is ready once the export is done." },
  link_expired: { status: 410, copy: (p: Params) => `This review link has expired. Ask ${p.owner} for a new one.` },
  link_revoked: { status: 410, copy: (p: Params) => `This review link was turned off. Ask ${p.owner} for a new one.` },
  rate_limited: {
    status: 429,
    copy: (p: Params) => `This read token is over 30 requests in 10 seconds. Try again in ${p.seconds} seconds.`,
  },
  storage_unavailable: {
    status: 503,
    copy: () => "Media storage is unreachable. Uploads and exports are paused; nothing was saved.",
  },
  internal: { status: 500, copy: () => "Something went wrong on our side." },
  queue_unavailable: {
    status: 503,
    copy: () => "The export queue is unreachable. No export was started and no minutes were used.",
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;
export type ErrorParams = Params;

export function errorCopy(code: ErrorCode, params: ErrorParams = {}): string {
  return (ERRORS[code].copy as (p: Params) => string)(params);
}

export const FIELD_ERRORS = {
  title: "Give the project a title of 1 to 80 characters.",
  frame_rate: "Choose a frame rate from the list.",
  aspect_ratio: "Choose an aspect ratio from the list.",
  cutName: "Name the cut in 1 to 60 characters.",
  reviewerName: "Add your name in 1 to 60 characters.",
  body: "Notes are 1 to 2,000 characters.",
  mentions: "A note can mention at most 5 people.",
  text: "Captions are 1 or 2 lines of at most 42 characters each.",
  q: "Search is limited to 8 words and 200 characters.",
  limit: "Page size must be 1 to 100.",
  cursor: "This cursor is not valid.",
  file_name: "File names are 1 to 120 characters with no slashes, control characters or leading dot.",
  email: "No Gatecut account uses that email.",
  expires_in_seconds: "Links last 10 to 2,592,000 seconds.",
  other: "That value is not allowed here.",
} as const;

export const mentionCopy = (handle: string): string => `No one on this project is called @${handle}.`;

export const SRT_COPY = {
  cues: "This SRT file has more than 5,000 cues.",
  line: (n: number) => `Line ${n} is longer than 42 characters.`,
  lines: (n: number) => `Cue ${n} has more than 2 text lines.`,
  time: (n: number) => `Cue ${n} has a malformed time line.`,
  order: (n: number) => `Cue ${n} ends before it starts.`,
  short: (n: number) => `Cue ${n} is shorter than one frame.`,
  overlap: (n: number) => `Cue ${n} overlaps the cue before it.`,
  utf8: "This file is not UTF-8 text.",
} as const;

export const UPLOAD_REASONS = {
  type: "unknown file type",
  mp4: "MP4 header is damaged",
  wav: "WAV header is damaged",
  png: "PNG header is damaged",
  checksum: "checksum does not match",
  replaceType: "replacement must be the same type",
  replaceShort: (project: string) => `replacement is shorter than its use in ${project}`,
} as const;

export const BLOCKER = {
  inTheWay: (clip: string) => `${clip} is in the way`,
  sourceStart: "the source starts there",
  sourceEnd: "the source ends there",
  targetRow: "the target row is not free",
  newLength: "the new length does not fit",
  locked: (row: string) => `${row} is locked`,
  timelineStart: "the timeline starts there",
} as const;

export function gigabytes(bytes: number): string {
  const tenths = Math.floor((bytes * 10 + 500_000_000) / 1_000_000_000);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function allowanceText(a: Allowance | Omit<Allowance, "text">): string {
  return `Export minutes ${a.export_minutes_used} of ${a.export_minutes_allowance} · storage ${gigabytes(a.storage_bytes_used)} of ${gigabytes(a.storage_bytes_allowance)} GB`;
}

/** The hidden Project activity copy for a change somebody else made. */
export function activityCopy(author: string, op: OpSummary, rate: FrameRate): string {
  const clip = op.clip_name ?? "";
  const at = timecode(rate, op.at_frame ?? 0);
  switch (op.type) {
    case "move":
      return `${author} moved ${clip} to ${at}.`;
    case "trim":
      return `${author} trimmed ${clip}.`;
    case "split":
      return `${author} split ${clip} at ${at}.`;
    case "remove":
      return `${author} removed ${clip}.`;
    case "hide":
      return `${author} hid ${clip}.`;
    case "show":
      return `${author} showed ${clip}.`;
    case "set_layer":
      return `${author} shaped ${clip}.`;
    case "restore_cut":
      return `${author} restored ${op.cut_name}.`;
    case "set_aspect":
      return `${author} changed the frame to ${op.aspect_ratio}.`;
    default:
      return `${author} edited the timeline.`;
  }
}
