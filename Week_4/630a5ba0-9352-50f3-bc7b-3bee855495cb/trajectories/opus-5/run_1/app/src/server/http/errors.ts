import type { ApiErrorBody, SessionDto, TaskDto } from '../../shared/types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly current?: TaskDto | SessionDto;

  constructor(
    status: number,
    code: string,
    message: string,
    extra?: { fields?: Record<string, string>; current?: TaskDto | SessionDto },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = extra?.fields;
    this.current = extra?.current;
  }

  get body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.current) body.current = this.current;
    return body;
  }
}

export const methodNotAllowed = (): ApiError =>
  new ApiError(405, 'method_not_allowed', 'That method is not allowed on this path.');

export const payloadTooLarge = (limit: number): ApiError =>
  new ApiError(413, 'payload_too_large', `That body is larger than ${limit} bytes.`);

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'That content type is not supported here.');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Writes must come from this origin.');

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidCredentials = (): ApiError =>
  new ApiError(401, 'invalid_credentials', "That email and password don't match.");

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'That was not found.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'Your role cannot use this.');

export const workspaceReadOnly = (): ApiError =>
  new ApiError(402, 'workspace_read_only', 'This workspace is read-only.');

export const versionConflict = (current: TaskDto | SessionDto): ApiError =>
  new ApiError(409, 'version_conflict', 'It was changed on another device.', { current });

export const validation = (fields: Record<string, string>, message = 'Check the highlighted fields.'): ApiError =>
  new ApiError(422, 'validation_failed', message, { fields });

export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);

export const unprocessable = (code: string, message: string): ApiError =>
  new ApiError(422, code, message);
