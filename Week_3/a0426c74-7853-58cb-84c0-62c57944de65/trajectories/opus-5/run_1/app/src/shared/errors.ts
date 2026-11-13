export type ErrorCode =
  | 'too_large'
  | 'cross_origin'
  | 'unauthenticated'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'read_only'
  | 'sheet_locked'
  | 'layer_locked'
  | 'not_ball_in_court'
  | 'stale_base'
  | 'illegal_transition'
  | 'rfi_open'
  | 'out_of_order'
  | 'review_voided'
  | 'review_expired'
  | 'undo_superseded'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'username_taken'
  | 'quota_exceeded'
  | 'not_ready'
  | 'link_expired'
  | 'link_revoked'
  | 'wrong_type'
  | 'parse_failed'
  | 'invalid'
  | 'storage_unavailable';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  too_large: 413,
  cross_origin: 403,
  unauthenticated: 401,
  rate_limited: 429,
  not_found: 404,
  forbidden: 403,
  read_only: 403,
  sheet_locked: 403,
  layer_locked: 403,
  not_ball_in_court: 403,
  stale_base: 409,
  illegal_transition: 409,
  rfi_open: 409,
  out_of_order: 409,
  review_voided: 409,
  review_expired: 409,
  undo_superseded: 409,
  nothing_to_undo: 409,
  nothing_to_redo: 409,
  username_taken: 409,
  quota_exceeded: 409,
  not_ready: 409,
  link_expired: 410,
  link_revoked: 410,
  wrong_type: 422,
  parse_failed: 422,
  invalid: 422,
  storage_unavailable: 503,
};

/** The one published error order for the whole API. */
export const ERROR_ORDER: ErrorCode[] = [
  'too_large',
  'cross_origin',
  'unauthenticated',
  'rate_limited',
  'not_found',
  'forbidden',
  'read_only',
  'sheet_locked',
  'layer_locked',
  'not_ball_in_court',
  'stale_base',
  'illegal_transition',
  'rfi_open',
  'out_of_order',
  'review_voided',
  'review_expired',
  'undo_superseded',
  'nothing_to_undo',
  'nothing_to_redo',
  'username_taken',
  'not_ready',
  'link_expired',
  'link_revoked',
  'wrong_type',
  'quota_exceeded',
  'invalid',
  'storage_unavailable',
  'parse_failed',
];

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly lines?: string[];

  constructor(code: ErrorCode, message: string, extra?: { fields?: Record<string, string>; lines?: string[] }) {
    super(message);
    this.code = code;
    this.fields = extra?.fields;
    this.lines = extra?.lines;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.lines) body.lines = this.lines;
    return body;
  }
}

export function errorRank(code: ErrorCode): number {
  return ERROR_ORDER.indexOf(code);
}

/** Of the errors that apply, the first in the published order. */
export function firstError(candidates: ApiError[]): ApiError | null {
  let best: ApiError | null = null;
  for (const candidate of candidates) {
    if (!best || errorRank(candidate.code) < errorRank(best.code)) best = candidate;
  }
  return best;
}

export const MESSAGES = {
  wrongCredentials: 'Wrong username or password.',
  signInRateLimit: 'Too many sign-ins. Wait a minute and try again.',
  badUsername: 'Use 3 to 24 lower-case letters, digits or underscores.',
  shortPassword: 'Use at least 8 characters.',
  usernameTaken: 'That username is taken.',
  crossOrigin: 'Requests from other sites are refused.',
  notFound: 'We couldn\u2019t find that page.',
  bodyTooLarge: 'That request is too large.',
  staleBase: 'This change is too old. Reload the drawing and try again.',
  rateLimited: 'Too many changes. Wait a moment and try again.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'You don\u2019t have permission to do that.',
  readOnly: 'You can view this drawing but not edit it.',
  noAccess: 'You no longer have access to this drawing.',
  nothingToUndo: 'Nothing to undo.',
  nothingToRedo: 'Nothing to redo.',
  notReady: 'That export isn\u2019t ready yet.',
  linkExpired: 'This link has expired.',
  linkRevoked: 'This link was turned off.',
  closeRfiFirst: 'Close its RFI first.',
  outOfOrder: 'Waiting on the step before.',
  reviewExpired: 'This review expired.',
  wrongTypeUnderlay: 'Underlays must be PNG or JPEG images.',
  wrongTypeText: 'That isn\u2019t a Plotfold drawing text file.',
  publishOutage: 'File storage is unavailable. Nothing was published. Try again in a moment.',
  underlayOutage: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  exportOutage: 'Export failed: file storage is unavailable.',
  phoneCommands: 'Drawing commands aren\u2019t available on a phone. Open this drawing on a desktop to edit.',
  parseFailed: 'That file has errors.',
  invalid: 'That isn\u2019t allowed.',
} as const;

export function underlayTooLarge(max: number): string {
  return `That image is larger than ${max} bytes.`;
}

export function textTooLarge(max: number): string {
  return `That file is larger than ${max} bytes.`;
}

export function quotaExceeded(quota: number): string {
  return `This drawing\u2019s underlays would pass ${quota} bytes.`;
}

export function layerLockedMessage(layer: string): string {
  return `Layer ${layer} is locked.`;
}

export function sheetLockedMessage(user: string): string {
  return `This sheet is locked by ${user}.`;
}
