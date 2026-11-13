// The one published API error shape, codes and the one error order.
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
  'quota_exceeded',
  'not_ready',
  'wrong_type',
  'quota_exceeded',
  'invalid',
  'storage_unavailable',
  'parse_failed',
];

export interface ErrorFields {
  [field: string]: string;
}

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: ErrorFields;
  lines?: string[];
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: ErrorFields;
  readonly lines?: string[];

  constructor(code: ErrorCode, message: string, extra?: { fields?: ErrorFields; lines?: string[] }) {
    super(message);
    this.code = code;
    this.fields = extra?.fields;
    this.lines = extra?.lines;
  }

  status(): number {
    return ERROR_STATUS[this.code];
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.lines) body.lines = this.lines;
    return body;
  }
}

// Rejects with the first error that applies, in the published order.
export function firstError(candidates: Array<ApiError | null>): ApiError | null {
  for (const code of ERROR_ORDER) {
    const hit = candidates.find((candidate) => candidate !== null && candidate.code === code);
    if (hit) return hit;
  }
  return null;
}

export const ERROR_TEXT = {
  crossOrigin: 'Requests from other sites are refused.',
  wrongCredentials: 'Wrong username or password.',
  staleBase: 'This change is too old. Reload the drawing and try again.',
  layerLocked: (layer: string): string => `Layer ${layer} is locked.`,
  notBallInCourt: (user: string): string => `This RFI is with ${user}.`,
  rfiOpen: 'Close its RFI first.',
  issueTransition: (from: string, to: string): string => `An issue can't go from ${from} to ${to}.`,
  rfiTransition: (from: string, to: string): string => `An RFI can't go from ${from} to ${to}.`,
  versionTransition: (from: string, to: string): string => `A version can't go from ${from} to ${to}.`,
  conflictMove: (user: string, handle: string): string => `${user} moved ${handle} after you.`,
  conflictChange: (user: string, handle: string): string => `${user} changed ${handle} after you.`,
  conflictDeleted: (user: string, handle: string): string => `${user} deleted ${handle}. Your change was dropped.`,
  conflictLayerDeleted: (user: string, layer: string): string => `${user} deleted layer ${layer}. Your entity is on layer 0.`,
  conflictBlockRedefined: (user: string, block: string): string => `${user} redefined ${block}. Your insert uses the new one.`,
  undoSuperseded: (user: string, handle: string): string => `Can't undo: ${user} changed ${handle} after you.`,
  reviewWaiting: 'Waiting on the step before.',
  reviewVoided: (n: number): string => `Review voided: version ${n} replaced this one.`,
  reviewExpired: 'This review expired.',
  sheetLocked: (user: string): string => `This sheet is locked by ${user}.`,
  layerCantDelete: 'Layer 0 can\u0027t be deleted.',
  layerHasEntities: (name: string, n: number): string => `Layer ${name} has ${n} entities. Move them first.`,
  blockSelfReference: (name: string, chain: string): string => `Block ${name} can't contain itself: ${chain}.`,
  circularReference: (chain: string): string => `Circular reference: ${chain}.`,
  storageDown: 'File storage is unavailable. Nothing was published. Try again in a moment.',
  storageDownUnderlay: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  storageDownImport: 'File storage is unavailable. Nothing was added. Try again in a moment.',
  exportFailed: 'Export failed: file storage is unavailable.',
  loginRate: 'Too many sign-ins. Wait a minute and try again.',
  badUsername: 'Use 3 to 24 lower-case letters, digits or underscores.',
  shortPassword: 'Use at least 8 characters.',
  usernameTaken: 'That username is taken.',
  underlayTooLarge: (max: number): string => `That image is larger than ${max} bytes.`,
  underlayType: 'Underlays must be PNG or JPEG images.',
  underlayQuota: (quota: number): string => `This drawing's underlays would pass ${quota} bytes.`,
  textTooLarge: (max: number): string => `That file is larger than ${max} bytes.`,
  textType: 'That isn\u2019t a Plotfold drawing text file.',
} as const;
