// The one API error shape and the one precedence order.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function errNotSignedIn(): ApiError {
  return new ApiError(401, "not_signed_in", "You need to sign in.");
}
export function errBadCredentials(): ApiError {
  return new ApiError(401, "bad_credentials", "That email and password do not match.");
}
export function errForbidden(): ApiError {
  return new ApiError(403, "forbidden", "You may not do that.");
}
export function errNotFound(): ApiError {
  return new ApiError(404, "not_found", "There is no such record.");
}
export function errUnsupportedType(): ApiError {
  return new ApiError(415, "unsupported_type", "Send JSON.");
}
export function errTooLarge(): ApiError {
  return new ApiError(413, "too_large", "That request is too large.");
}
export function errDatabaseUnavailable(): ApiError {
  return new ApiError(503, "database_unavailable", "The database is not answering.");
}
export function errIllegalTransition(): ApiError {
  return new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
}

export function fieldErrors(errors: Record<string, string>): ApiError {
  return new ApiError(422, "validation", "Some fields need attention.", { errors });
}
