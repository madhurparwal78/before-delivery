/** The one published error shape, built in one place. */

export type ErrorFields = Record<string, string>;

export type ErrorBody = {
  error: { code: string; message: string };
  fields?: ErrorFields;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ErrorFields | null;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: ErrorFields; headers?: Record<string, string> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields ?? null;
    this.headers = options?.headers ?? {};
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields !== null) body.fields = this.fields;
    return body;
  }
}

export function invalid(fields: ErrorFields): ApiError {
  return new ApiError(422, 'invalid', 'Check the highlighted fields.', { fields });
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Nothing in this drawer.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'This is not yours to do.');
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}
