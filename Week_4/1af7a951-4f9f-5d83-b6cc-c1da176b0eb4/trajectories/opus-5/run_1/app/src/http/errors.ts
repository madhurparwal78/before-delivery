export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body['error'] === 'string' ? body['error'] : 'error');
    this.status = status;
    this.body = body;
  }
}

export function apiError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(status, { error: code, ...extra });
}

export function validationError(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

export function illegalTransition(from: string, to: string): ApiError {
  return new ApiError(409, { error: 'illegal_transition', from, to });
}

export const notFound = (): ApiError => apiError(404, 'not_found');
export const unauthenticated = (): ApiError => apiError(401, 'unauthenticated');
export const forbidden = (): ApiError => apiError(403, 'forbidden');
