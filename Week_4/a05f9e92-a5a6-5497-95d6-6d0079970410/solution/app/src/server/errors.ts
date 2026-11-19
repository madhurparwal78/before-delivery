interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; [extra: string]: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>): never {
  throw new ApiError(status, code, message, fields, extra);
}

export function errorBody(error: ApiError): ErrorBody {
  const body: ErrorBody = { error: { code: error.code, message: error.message } };
  if (error.fields) body.error.fields = error.fields;
  if (error.extra) Object.assign(body.error, error.extra);
  return body;
}

export const unauthenticated = (): never => fail(401, "unauthenticated", "Sign in to continue.");
export const notFound = (): never => fail(404, "not_found", "No such record.");
export const operatorOnly = (): never => fail(403, "operator_only", "Only the operator can do this.");
export const forbidden = (): never => fail(403, "forbidden", "Your role cannot do this.");
export const validation = (message: string, fields?: Record<string, string>): never => fail(422, "validation", message, fields);
export const storageUnavailable = (): never =>
  fail(503, "storage_unavailable", "File storage is unreachable. Try again when it returns.");
