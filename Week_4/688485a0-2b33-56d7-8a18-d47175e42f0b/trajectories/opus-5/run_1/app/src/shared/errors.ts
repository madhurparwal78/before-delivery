/** Every API error is built here and nowhere else. */

export type ErrorExtras = Record<string, unknown>;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extras: ErrorExtras;

  constructor(code: string, status: number, extras: ErrorExtras = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extras = extras;
  }

  body(): ErrorExtras {
    return { error: this.code, ...this.extras };
  }
}

export const unauthenticated = (): AppError => new AppError('unauthenticated', 401);
export const invalidCredentials = (): AppError => new AppError('invalid_credentials', 401);
export const notFound = (): AppError => new AppError('not_found', 404);
export const readOnly = (): AppError => new AppError('read_only', 403);
export const versionConflict = (currentVersion: number, current: unknown): AppError =>
  new AppError('version_conflict', 409, { current_version: currentVersion, current });
export const invitationClosed = (): AppError => new AppError('invitation_closed', 409);
export const alreadyMember = (): AppError => new AppError('already_member', 409);
export const alreadyInvited = (): AppError => new AppError('already_invited', 409);
export const notConfirmed = (): AppError => new AppError('not_confirmed', 409);
export const duplicateKey = (index: string, value: unknown): AppError =>
  new AppError('duplicate_key', 409, { index, value });
export const nameTaken = (): AppError => new AppError('name_taken', 409);
export const emailTaken = (): AppError => new AppError('email_taken', 409);
export const invalidField = (field: string): AppError => new AppError('invalid_field', 422, { field });
export const invalidId = (): AppError => new AppError('invalid_id', 422);
export const idMismatch = (): AppError => new AppError('id_mismatch', 422);
export const invalidProjection = (): AppError => new AppError('invalid_projection', 422);
export const invalidIndex = (): AppError => new AppError('invalid_index', 422);
export const invalidValidator = (): AppError => new AppError('invalid_validator', 422);
export const cannotDropIdIndex = (): AppError => new AppError('cannot_drop_id_index', 422);
export const ownerRoleFixed = (): AppError => new AppError('owner_role_fixed', 422);
export const invalidCode = (): AppError => new AppError('invalid_code', 422);
export const invalidFieldName = (path: string): AppError => new AppError('invalid_field_name', 422, { path });
export const documentTooLarge = (limit: number): AppError => new AppError('document_too_large', 422, { limit });
export const documentTooDeep = (limit: number): AppError => new AppError('document_too_deep', 422, { limit });
export const scanLimit = (limit: number): AppError => new AppError('scan_limit', 422, { limit });
export const tooManyStages = (limit: number): AppError => new AppError('too_many_stages', 422, { limit });
export const tooManyLines = (limit: number): AppError => new AppError('too_many_lines', 422, { limit });
export const queryTooDeep = (limit: number): AppError => new AppError('query_too_deep', 422, { limit });
export const validationFailed = (
  path: string,
  rule: 'required' | 'bsonType' | 'minimum' | 'maximum' | 'enum',
): AppError => new AppError('validation_failed', 422, { path, rule });
export const invalidQuery = (field: 'filter' | 'projection' | 'sort' | 'limit' | 'page'): AppError =>
  new AppError('invalid_query', 422, { field });
export const unknownOperator = (operator: string): AppError => new AppError('unknown_operator', 422, { operator });
export const unknownStage = (stage: string, index: number): AppError =>
  new AppError('unknown_stage', 422, { stage, index });
export const invalidStage = (index: number): AppError => new AppError('invalid_stage', 422, { index });
export const importFailed = (importId: string, errors: Array<{ line: number; message: string }>): AppError =>
  new AppError('import_failed', 422, { import_id: importId, errors });
export const storageUnavailable = (): AppError => new AppError('storage_unavailable', 503);
export const unsupportedMediaType = (): AppError => new AppError('unsupported_media_type', 415);
export const tooLarge = (limit: number): AppError => new AppError('too_large', 413, { limit });
