export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body['error'] === 'string' ? body['error'] : `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

export function validationError(errors: FieldErrors): AppError {
  return new AppError(422, { error: 'validation', errors });
}

export function notFound(): AppError {
  return new AppError(404, { error: 'not_found' });
}

export function forbidden(): AppError {
  return new AppError(403, { error: 'forbidden' });
}

export function unauthenticated(): AppError {
  return new AppError(401, { error: 'unauthenticated' });
}

export function conflict(error: string, extra?: Record<string, unknown>): AppError {
  return new AppError(409, { error, ...extra });
}

export function unavailable(error: string): AppError {
  return new AppError(503, { error });
}
