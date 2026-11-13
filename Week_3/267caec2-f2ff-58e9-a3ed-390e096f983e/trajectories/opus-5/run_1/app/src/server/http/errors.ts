export class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'validation_failed');
    this.status = status;
    this.body = body;
  }
}

export function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpError {
  return new HttpError(status, { error: code, message, ...extra });
}

export function invalid(fields: Record<string, string>): HttpError {
  return new HttpError(422, { errors: fields });
}
