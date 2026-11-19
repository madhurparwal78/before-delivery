import type { ApiErrorBody, CellJson, ColumnJson, RowJson, StacksJson } from '../shared/api.js';
import { copy } from '../shared/copy.js';

type ErrorExtra = Omit<ApiErrorBody['error'], 'code' | 'message'>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const payloadTooLarge = (): ApiError =>
  new ApiError(413, 'payload_too_large', 'The request body is too large.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'Send a JSON body.');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'This request came from another site.');

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidCredentials = (): ApiError =>
  new ApiError(401, 'invalid_credentials', copy.signInFailure);

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'Your role may not take this action.');

export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'invalid', 'Check the values you sent.', { fields });

export const idempotencyKeyError = (message: string): ApiError =>
  new ApiError(422, 'idempotency_key', 'Check the idempotency key you sent.', {
    fields: { idempotency_key: message },
  });

export const staleCell = (current: CellJson): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone else changed this cell first.', {
    current: { value: current.value, display: current.display, revision: current.revision },
  });

export const stalePaste = (
  current: CellJson,
  conflicts: NonNullable<ApiErrorBody['error']['conflicts']>,
): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone else changed these cells first.', {
    current: { value: current.value, display: current.display, revision: current.revision },
    conflicts,
  });

export const staleRow = (row: RowJson): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone else changed this row first.', {
    current: { row },
  });

export const staleColumn = (column: ColumnJson): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone else changed this column first.', {
    current: { column },
  });

export const staleTable = (table: { id: string; name: string; revision: number }): ApiError =>
  new ApiError(409, 'stale_revision', 'Someone else renamed this table first.', {
    current: { table },
  });

export const columnInSummary = (): ApiError =>
  new ApiError(409, 'column_in_summary', 'A summary uses this column.');

export const columnIsRowOwner = (): ApiError =>
  new ApiError(409, 'column_is_row_owner', 'This column is the row owner.');

export const nothingToUndo = (stacks: StacksJson): ApiError =>
  new ApiError(409, 'nothing_to_undo', copy.nothingToUndo, { stacks });

export const nothingToRedo = (stacks: StacksJson): ApiError =>
  new ApiError(409, 'nothing_to_redo', copy.nothingToRedo, { stacks });

export const undoConflict = (stacks: StacksJson): ApiError =>
  new ApiError(409, 'undo_conflict', copy.undoConflict, { stacks });

export const inviteAlreadySent = (): ApiError =>
  new ApiError(409, 'invite_already_sent', copy.inviteAlreadySent);

export const exportNotReady = (): ApiError =>
  new ApiError(409, 'export_not_ready', 'This export is not ready.');

export const mailUnavailable = (): ApiError =>
  new ApiError(503, 'mail_unavailable', 'The mail server is unreachable.');

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'The file store is unreachable.');

export const databaseUnavailable = (): ApiError =>
  new ApiError(503, 'database_unavailable', 'The database is unreachable.');

export const exportCorrupt = (): ApiError =>
  new ApiError(502, 'export_corrupt', 'The stored file no longer matches this export.');
