export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body['error'] === 'string' ? body['error'] : 'error');
    this.status = status;
    this.body = body;
  }
}

export const tooLarge = (limit: number): ApiError =>
  new ApiError(413, { error: 'too_large', limit });

export const unauthenticated = (): ApiError => new ApiError(401, { error: 'unauthenticated' });

export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });

export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });

export const invalidState = (status: string): ApiError =>
  new ApiError(409, { error: 'invalid_state', status });

export const linkClosed = (state: string): ApiError =>
  new ApiError(409, { error: 'link_closed', state });

export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, { error: 'validation', fields });

export const storageUnavailable = (): ApiError =>
  new ApiError(503, { error: 'storage_unavailable' });

export const mailUnavailable = (): ApiError => new ApiError(503, { error: 'mail_unavailable' });
