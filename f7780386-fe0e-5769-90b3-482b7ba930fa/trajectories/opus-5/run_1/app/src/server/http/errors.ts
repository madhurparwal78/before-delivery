/** Every error leaves the server in the one error shape from the API section. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export const unauthenticated = (): HttpError => new HttpError(401, 'unauthenticated');
export const notFound = (): HttpError => new HttpError(404, 'not_found');
export const forbidden = (): HttpError => new HttpError(403, 'forbidden');
export const methodNotAllowed = (): HttpError => new HttpError(405, 'method_not_allowed');

export const validationFailed = (errors: Record<string, string>): HttpError =>
  new HttpError(422, 'validation_failed', { errors });

export const invalidField = (field: string, code: string): HttpError =>
  validationFailed({ [field]: code });

export const conflict = (code: string, extra: Record<string, unknown> = {}): HttpError =>
  new HttpError(409, code, extra);
