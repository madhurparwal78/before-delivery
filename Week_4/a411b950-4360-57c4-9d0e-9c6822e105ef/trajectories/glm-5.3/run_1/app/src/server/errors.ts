/**
 * The single consistent error shape for the whole API (DP: API conventions):
 * {"error":"<code>","message":"<sentence>"} with optional extra keys.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extras: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function validationError(fieldErrors: Record<string, string>): AppError {
  return new AppError(422, "validation", "Check the highlighted fields.", { errors: fieldErrors });
}

export function notFound(message = "Not found."): AppError {
  return new AppError(404, "not_found", message);
}

export function staleVersion(current: unknown): AppError {
  return new AppError(412, "stale_version", "This record changed in another window.", { current });
}

export function preconditionRequired(): AppError {
  return new AppError(428, "precondition_required", "Send the version you read before saving.");
}

export function illegalTransition(from: string, to: string): AppError {
  return new AppError(409, "illegal_transition", "That move isn't allowed from the current state.", {
    from,
    to,
  });
}

export function conflict(code: string, message: string, extras: Record<string, unknown> = {}): AppError {
  return new AppError(409, code, message, extras);
}

export function storageUnavailable(): AppError {
  return new AppError(503, "storage_unavailable", "Storage is unreachable. Try again in a few minutes.");
}

export function billingUnavailable(): AppError {
  return new AppError(503, "billing_unavailable", "Billing is unreachable. Try again in a few minutes.");
}

export function databaseUnavailable(): AppError {
  return new AppError(503, "database_unavailable", "The database is unreachable. Try again in a few minutes.");
}

export function crossOrigin(): AppError {
  return new AppError(403, "cross_origin", "Requests from another origin are not accepted.");
}

export function payloadTooLarge(): AppError {
  return new AppError(413, "payload_too_large", "That request is too large.");
}

export function malformedJson(): AppError {
  return new AppError(400, "malformed_json", "That request body is not valid JSON.");
}

export function readOnly(message = "This endpoint is read-only."): AppError {
  return new AppError(405, "read_only", message);
}

export function methodNotAllowed(): AppError {
  return new AppError(405, "method_not_allowed", "That method is not allowed on this path.");
}

export function unauthenticated(message = "Sign in to use the console."): AppError {
  return new AppError(401, "unauthenticated", message);
}
