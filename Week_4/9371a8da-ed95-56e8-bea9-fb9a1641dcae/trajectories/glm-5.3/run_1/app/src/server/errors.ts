import type { Response } from 'express';

/** The one place where every error answer is built. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated');
export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');
export const internal = () => new ApiError(500, 'internal');
export const methodNotAllowed = () => new ApiError(405, 'method_not_allowed');
export const staleRevision = (current: unknown) =>
  new ApiError(412, 'stale_revision', undefined, { current });
export const pathTaken = () => new ApiError(409, 'path_taken');
export const tooLarge = () => new ApiError(413, 'too_large');
export const unsupportedFileType = () => new ApiError(415, 'unsupported_file_type');
export const malformedJson = () => new ApiError(400, 'malformed_json');
export const unsupportedMediaType = () => new ApiError(415, 'unsupported_media_type');
export const crossOrigin = () => new ApiError(403, 'cross_origin');
export const invalid = (errors: Record<string, string>) => new ApiError(422, 'invalid', errors);
export const storageUnavailable = () => new ApiError(503, 'storage_unavailable');
export const mailUnavailable = () => new ApiError(503, 'mail_unavailable');
export const suggestionClosed = (suggestion: unknown) =>
  new ApiError(409, 'suggestion_closed', undefined, { suggestion });
export const threadResolved = () => new ApiError(409, 'thread_resolved');
export const labelTaken = () => new ApiError(409, 'label_taken');
export const alreadyMember = (projectId?: string) =>
  projectId === undefined
    ? new ApiError(409, 'already_member')
    : new ApiError(409, 'already_member', undefined, { projectId });
export const invitePending = () => new ApiError(409, 'invite_pending');
export const inviteNotPending = () => new ApiError(409, 'invite_not_pending');
export const inviteUnavailable = (status: string) =>
  new ApiError(410, 'invite_unavailable', undefined, { status });
export const invalidCredentials = () => new ApiError(401, 'invalid_credentials');
export const lastOwner = () => new ApiError(409, 'last_owner');
export const rateLimited = (retryAfterSeconds: number) =>
  new ApiError(429, 'rate_limited', undefined, { retryAfterSeconds });
export const notReady = (readiness: Record<string, number>) =>
  new ApiError(409, 'not_ready', undefined, { readiness });
export const idempotencyKeyReused = () => new ApiError(409, 'idempotency_key_reused');
export const readOnly = () => new ApiError(405, 'read_only');

export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.code };
    if (err.errors) body.errors = err.errors;
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.status).json(body);
    return;
  }
  res.status(500).json({ error: 'internal' });
}
