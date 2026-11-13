import { BODY_MAX_BYTES, settings } from './env.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'bad_credentials'
  | 'key_invalid'
  | 'key_expired'
  | 'key_revoked'
  | 'forbidden'
  | 'key_scope'
  | 'not_found'
  | 'name_taken'
  | 'mapping_exists'
  | 'generation_read_only'
  | 'case_flow'
  | 'snapshot_expired'
  | 'body_too_large'
  | 'upload_too_large'
  | 'upload_kind'
  | 'invalid'
  | 'query_too_long'
  | 'query_too_deep'
  | 'query_work_limit'
  | 'query_time_budget'
  | 'query_syntax'
  | 'result_window'
  | 'field_conflict'
  | 'pipe_syntax'
  | 'unknown_pipeline'
  | 'trace_invalid'
  | 'rate_limited'
  | 'storage_unavailable'
  | 'database_unavailable';

/** The one error shape every failure leaves the server through. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly position?: number;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    extra: { position?: number; fields?: Record<string, string>; retryAfter?: number } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.position = extra.position;
    this.fields = extra.fields;
    this.retryAfter = extra.retryAfter;
  }

  body(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.position !== undefined) out.position = this.position;
    if (this.fields !== undefined) out.fields = this.fields;
    return out;
  }
}

export const fail = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  badCredentials: () => new ApiError(401, 'bad_credentials', 'Username or password is wrong.'),
  keyInvalid: () => new ApiError(401, 'key_invalid', "This API key isn't valid."),
  keyExpired: () => new ApiError(401, 'key_expired', 'This API key has expired.'),
  keyRevoked: () => new ApiError(401, 'key_revoked', 'This API key was revoked.'),
  forbidden: () => new ApiError(403, 'forbidden', "Your role in this space can't do this."),
  keyScope: (action: 'upload' | 'read' | 'manage', stream: string) =>
    new ApiError(403, 'key_scope', `This key can't ${action} stream ${stream}.`),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  nameTaken: (fields?: Record<string, string>) =>
    new ApiError(409, 'name_taken', 'That name is already used.', { fields }),
  mappingExists: (field: string, generation: number) =>
    new ApiError(409, 'mapping_exists', `Field ${field} already has a type in generation ${generation}.`),
  generationReadOnly: (generation: number, phase: string) =>
    new ApiError(409, 'generation_read_only', `Generation ${generation} is ${phase} and read-only.`),
  caseFlow: (from: string, to: string) =>
    new ApiError(409, 'case_flow', `A case can't go from ${from} to ${to}.`),
  snapshotExpired: () =>
    new ApiError(410, 'snapshot_expired', 'This snapshot expired. Results may have changed. Start a new search.'),
  bodyTooLarge: () =>
    new ApiError(413, 'body_too_large', `Request body is larger than ${BODY_MAX_BYTES} bytes.`),
  uploadTooLarge: () =>
    new ApiError(413, 'upload_too_large', `Upload is larger than ${settings.uploadMaxBytes} bytes.`),
  uploadKind: () => new ApiError(415, 'upload_kind', 'Only .ndjson files can be uploaded.'),
  invalid: (fields: Record<string, string>) =>
    new ApiError(422, 'invalid', 'Check the highlighted fields.', { fields }),
  queryTooLong: () =>
    new ApiError(422, 'query_too_long', `Query is longer than ${settings.queryMaxLen} characters.`),
  queryTooDeep: () =>
    new ApiError(422, 'query_too_deep', `Query nests deeper than ${settings.queryMaxDepth} levels.`),
  queryWorkLimit: () =>
    new ApiError(422, 'query_work_limit', `Query stopped: work limit of ${settings.queryWorkMax} reached.`),
  queryTimeBudget: () =>
    new ApiError(422, 'query_time_budget', `Query stopped: time budget of ${settings.queryBudgetMs} ms reached.`),
  querySyntax: (message: string, position: number) =>
    new ApiError(422, 'query_syntax', message, { position }),
  resultWindow: () =>
    new ApiError(422, 'result_window', `Results past ${settings.resultWindow} need a snapshot.`),
  fieldConflict: (message: string) => new ApiError(422, 'field_conflict', message),
  pipeSyntax: (message: string, position: number) =>
    new ApiError(422, 'pipe_syntax', message, { position }),
  unknownPipeline: (name: string) =>
    new ApiError(422, 'unknown_pipeline', `Pipeline ${name} doesn't exist.`),
  traceInvalid: (message: string) => new ApiError(422, 'trace_invalid', message),
  rateLimited: (seconds: number) =>
    new ApiError(429, 'rate_limited', `Too many requests. Try again in ${seconds} seconds.`, {
      retryAfter: seconds,
    }),
  storageUnavailable: () =>
    new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was stored.'),
  databaseUnavailable: () =>
    new ApiError(503, 'database_unavailable', 'The event store is unavailable. Try again shortly.'),
};
