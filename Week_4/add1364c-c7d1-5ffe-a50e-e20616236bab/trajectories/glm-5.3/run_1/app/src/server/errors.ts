import type { ServerResponse } from 'node:http';

export interface FieldErrors {
  [field: string]: string;
}

/** The one published error shape; built in this one place. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: FieldErrors,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
  }
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Nothing in this drawer.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'Your role may not do this.');
}

export function invalid(fields: FieldErrors): ApiError {
  return new ApiError(422, 'invalid', 'Check the highlighted fields.', fields);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function unavailable(code: string, message: string): ApiError {
  return new ApiError(503, code, message);
}

export function writeError(res: ServerResponse, error: ApiError): void {
  const body: { error: { code: string; message: string; fields?: FieldErrors } } = {
    error: { code: error.code, message: error.message }
  };
  if (error.fields && Object.keys(error.fields).length > 0) {
    body.error.fields = error.fields;
  }
  const payload = JSON.stringify(body);
  res.writeHead(error.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...(error.headers ?? {})
  });
  res.end(payload);
}
