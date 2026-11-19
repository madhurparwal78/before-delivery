/**
 * The one error model: every API error carries one body shape and one
 * of the published codes, and handlers apply the published precedence.
 */

export type ErrorCode =
  | 'too_large' | 'unauthenticated' | 'bad_credentials' | 'session_expired' | 'rate_limited'
  | 'not_found' | 'link_expired' | 'link_revoked' | 'forbidden' | 'branch_locked'
  | 'stale_base' | 'op_id_reused' | 'username_taken' | 'invalid_transition' | 'session_ended'
  | 'already_presenting' | 'not_ready' | 'clipboard_empty' | 'quota_exceeded'
  | 'invalid' | 'wrong_type' | 'invalid_outline' | 'root_protected' | 'storage_unavailable';

const STATUS: Record<ErrorCode, number> = {
  too_large: 413,
  unauthenticated: 401,
  bad_credentials: 401,
  session_expired: 401,
  rate_limited: 429,
  not_found: 404,
  link_expired: 404,
  link_revoked: 404,
  forbidden: 403,
  branch_locked: 403,
  stale_base: 409,
  op_id_reused: 409,
  username_taken: 409,
  invalid_transition: 409,
  session_ended: 409,
  already_presenting: 409,
  not_ready: 409,
  clipboard_empty: 409,
  quota_exceeded: 409,
  invalid: 422,
  wrong_type: 422,
  invalid_outline: 422,
  root_protected: 422,
  storage_unavailable: 503,
};

/** ApiError: thrown anywhere in the server, rendered by the one writer. */
export class ApiError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
  lines?: string[];
  retryAfter?: number;

  constructor(code: ErrorCode, message: string, extra?: { fields?: Record<string, string>; lines?: string[]; retryAfter?: number }) {
    super(message);
    this.code = code;
    this.fields = extra?.fields;
    this.lines = extra?.lines;
    this.retryAfter = extra?.retryAfter;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export function errorBody(e: ApiError): ErrorBody {
  const body: ErrorBody = { error: e.code, message: e.message };
  if (e.fields && Object.keys(e.fields).length > 0) body.fields = e.fields;
  if (e.lines && e.lines.length > 0) body.lines = e.lines;
  return body;
}

// ---- published notice and copy sentences --------------------------------

export const NOTICES = {
  offlineBanner: (n: number) => n === 1 ? `You're working offline. 1 change waiting.` : `You're working offline. ${n} changes waiting.`,
  connectionLost: (n: number) => n === 1 ? `Connection lost. Trying again. 1 change waiting.` : `Connection lost. Trying again. ${n} changes waiting.`,
  backOnline: (n: number, k: number) => `Back online: ${n} ${n === 1 ? 'change' : 'changes'} sent, ${k} ${k === 1 ? 'conflict' : 'conflicts'}.`,
  cycleRollback: (t: string) => `Move undone: ${t} can't go inside its own branch.`,
  movedAfterYou: (u: string, t: string) => `${u} moved ${t} after you.`,
  deletedUnderYou: (u: string) => `${u} deleted this branch. Your edit is in Recovered edits.`,
  orderChanged: (u: string) => `Order changed: ${u} reordered these topics too.`,
  lockedMove: (t: string) => `Nothing moved: ${t} is locked.`,
  lockedEdit: (t: string, u: string) => `${t} is locked by ${u}.`,
  undoSkipped: (u: string, t: string) => `Can't undo: ${u} changed ${t} after you.`,
  redoSkipped: (u: string, t: string) => `Can't redo: ${u} changed ${t} after you.`,
  undoDone: 'Undone.',
  redoDone: 'Redone.',
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  rootDelete: "The central topic can't be deleted.",
  readOnly: 'You can view this map but not edit it.',
  cannotMove: (t: string) => `${t} can't move that way.`,
  movePosition: (t: string, k: number, n: number, parent: string) => `${t} is now ${k} of ${n} under ${parent}.`,
  selection: (n: number) => n === 1 ? `1 topic selected.` : `${n} topics selected.`,
  collapse: (t: string) => `${t} collapsed`,
  expand: (t: string) => `${t} expanded`,
  dropPreview: (t: string, target: string) => `Drop to make ${t} a child of ${target}`,
  dependencyLoop: 'That would make a dependency loop.',
  linkScheme: 'Links must start with http:// or https://.',
  replace: (n: number, k: number) => `Replaced ${n}. Skipped ${k} locked.`,
  findCount: (k: number, n: number) => `${k} of ${n}`,
  noMatches: 'No matches',
  copied: (n: number) => `Copied ${n} ${n === 1 ? 'topic' : 'topics'}.`,
  pasted: (n: number) => `Pasted ${n} ${n === 1 ? 'topic' : 'topics'}.`,
  nothingToPaste: 'Nothing to paste.',
  missingTopic: 'That topic no longer exists.',
  focusBranchDeleted: 'This branch was deleted. Showing the whole map.',
  following: (n: string) => `Following ${n}.`,
  stoppedFollowing: (n: string) => `Stopped following ${n}.`,
  emptyMapPrompt: 'Press Tab to add the first branch.',
  roleChange: (r: string) => `Your role is now ${r}.`,
  accessRemoved: 'You no longer have access to this map.',
  expiredLink: 'This link has expired.',
  turnedOff: "This link was turned off by the map's owner.",
  unknownMap: "We couldn't find that map.",
  unknownPage: "We couldn't find that page.",
  emptyMapList: 'You have no maps yet. Start one from a central idea.',
  sessionDialog: 'Your session ended. Sign in again to keep your changes.',
  usernameField: 'Username must be 3 to 24 characters: lowercase letters, digits or underscores.',
  passwordField: 'Password must be at least 8 characters.',
  taken: 'That username is taken.',
  wrongCredentials: 'Wrong username or password.',
  rateLimited: 'Too many sign-in attempts. Try again in a minute.',
  blockedBy: (t: string) => `Blocked by ${t}`,
  blockedCount: (n: number) => `${n} blocked`,
  overdue: 'Overdue',
  rollupDash: '\u2014',
  sliderValue: (k: number, n: number, u: string) => `Version ${k} of ${n} by ${u}`,
  readOnlyVersion: (k: number) => `This is version ${k}. Read only.`,
  diffSummary: (a: number, r: number, m: number, e: number) => `Added ${a}, removed ${r}, moved ${m}, edited ${e}`,
  versionSaved: (k: number) => `Saved version ${k}.`,
  versionRestored: (k: number) => `Restored version ${k}.`,
  followerCount: (n: number) => `${n} following`,
  slideCounter: (k: number, n: number) => `Slide ${k} of ${n}`,
  slideSkippedDeleted: (k: number) => `Slide ${k} was skipped: its topic was deleted.`,
  slideSkippedRestricted: (k: number) => `Slide ${k} was skipped: it is restricted.`,
  audienceWaiting: (u: string) => `The presentation hasn't started yet. It will appear here when ${u} goes live.`,
  audiencePaused: 'The presenter has stepped away. The show will continue here.',
  audienceEnded: 'This presentation has ended.',
  attachPending: (f: string) => `Uploading ${f}`,
  attachDone: 'Image attached.',
  attachTooLarge: (limit: number) => `This image is larger than ${limit} bytes.`,
  attachWrongType: 'Only PNG and JPEG images can be attached.',
  attachQuota: (quota: number) => `This map's images would pass its ${quota} byte limit.`,
  storageOutageFiles: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  importPending: (f: string) => `Reading ${f}`,
  importPreview: (n: number, t: string) => `Adds ${n} ${n === 1 ? 'topic' : 'topics'} under ${t}.`,
  importErrorHeading: "This file can't be imported:",
  exportReady: 'Export ready.',
  exportFailed: 'Export failed: file storage is unavailable.',
  versionOutage: 'File storage is unavailable. The version was not saved. Try again in a moment.',
  restoreOutage: 'File storage is unavailable. Nothing was restored. Try again in a moment.',
  readViewOnly: 'View only',
} as const;
