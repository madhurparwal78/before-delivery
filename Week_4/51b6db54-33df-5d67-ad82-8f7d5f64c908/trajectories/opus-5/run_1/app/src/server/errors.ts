/** Every API error comes from this one shape, in the published order. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`api ${status}`);
    this.status = status;
    this.body = body;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, { error: 'unauthenticated' });

export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });

export const forbidden = (message: string): ApiError =>
  new ApiError(403, { error: 'forbidden', message });

export const conflict = (body: Record<string, unknown>): ApiError => new ApiError(409, body);

export const unprocessable = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { errors });

export const tooLarge = (): ApiError => new ApiError(413, { error: 'too_large' });

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, { error: 'unsupported_media_type' });

export const databaseUnavailable = (): ApiError =>
  new ApiError(503, { error: 'database_unavailable' });

export const storageUnavailable = (): ApiError => new ApiError(503, { error: 'storage_unavailable' });

export const READ_ONLY_LINK = 'This link is read only';
export const REVIEWER_DRAW = "Reviewers can't draw";
export const REVIEWER_ARTWORK = "Reviewers can't change artwork";
export const REVIEWER_EXPORT = "Reviewers can't export";
export const OWNER_ONLY = 'Only the project owner can do this';
export const CROSS_ORIGIN = 'Cross-origin request refused';
