import { ApiErrorBody } from '../../shared/api';

/** Every API error is produced through this one shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly text: string,
    readonly extra: { fields?: Record<string, string>; limit?: number } = {},
  ) {
    super(text);
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: { code: this.code, message: this.text } };
    if (this.extra.fields) body.fields = this.extra.fields;
    if (this.extra.limit !== undefined) body.limit = this.extra.limit;
    return body;
  }
}

export const apiErrors = {
  payloadTooLarge: (limit: number) =>
    new ApiError(413, 'payload_too_large', 'That request is larger than the limit.', { limit }),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted.'),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'Email or password is wrong.'),
  notFound: () => new ApiError(404, 'not_found', 'It may have been removed, or it belongs to another station.'),
  forbidden: () => new ApiError(403, 'forbidden', 'Your role cannot use this action.'),
  roleCannotEdit: () => new ApiError(403, 'role_cannot_edit', "Your role can't make this edit right now."),
  idempotencyKeyReused: () =>
    new ApiError(409, 'idempotency_key_reused', 'That request key was already used with a different request.'),
  badIdempotencyKey: () =>
    new ApiError(422, 'invalid_request', 'Send a request key.', {
      fields: { 'Idempotency-Key': 'Send a key of 8 to 128 printable characters.' },
    }),
  validation: (fields: Record<string, string>) =>
    new ApiError(422, 'invalid_request', 'Some fields need attention.', { fields }),
  storageUnavailable: () =>
    new ApiError(503, 'storage_unavailable', 'File storage is unavailable right now.'),
  seasonLocked: () => new ApiError(409, 'season_locked', 'The season is closed.'),
  seasonArchived: () => new ApiError(409, 'season_archived', 'The workbook is archived.'),
  sheetMissing: () => new ApiError(409, 'sheet_missing', 'That sheet no longer exists.'),
  conflictResolved: () => new ApiError(409, 'conflict_resolved', 'That conflict was already resolved.'),
  illegalTransition: (action: string, state: string) =>
    new ApiError(409, 'illegal_transition', `Cannot ${action} a workbook that is ${state}.`),
  memberExists: (email: string) =>
    new ApiError(409, 'member_exists', `${email} is already a member of this station.`),
  lastDataManager: () =>
    new ApiError(409, 'last_data_manager', 'A station must keep at least one data manager.'),
  linkInactive: () => new ApiError(409, 'link_inactive', 'That link is no longer active.'),
  exportNotReady: () => new ApiError(409, 'export_not_ready', 'That export file is not ready yet.'),
  unsupportedFile: () => new ApiError(415, 'unsupported_file', "That file isn't a real .xlsx or .csv workbook."),
  readOnly: () => new ApiError(405, 'read_only', 'Share links are read-only.'),
};
