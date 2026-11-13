// One error shape for every API refusal. The precedence (413, 400, 401, 429, then 404, 403, 409, 422, 503) is the order in which
// `http.ts` and the handlers check: body size, JSON, session, rate limit, resource, role, state, fields, services.

type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 422 | 429 | 503;

interface ErrorBody {
  readonly error: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class ApiError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(status: ErrorStatus, code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { error: this.code, message: this.message }
      : { error: this.code, message: this.message, details: this.details };
  }
}

export const badRequest = (): ApiError => new ApiError(400, "bad_request", "The request body isn't valid JSON.");
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const notFound = (): ApiError => new ApiError(404, "not_found", "Not found.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "You don't have permission to do that.");
export const methodNotAllowed = (): ApiError => new ApiError(405, "method_not_allowed", "This method isn't allowed here.");
export const payloadTooLarge = (message: string): ApiError => new ApiError(413, "payload_too_large", message);
export const tooLarge = (max: number): ApiError => payloadTooLarge(`Request body is too large (${max} bytes at most).`);
export const rateLimited = (seconds: number): ApiError =>
  new ApiError(429, "rate_limited", `Too many requests. Try again in ${seconds} seconds.`);
export const badCredentials = (): ApiError => new ApiError(401, "bad_credentials", "Username or password is wrong.");
export const unavailable = (): ApiError => new ApiError(503, "unavailable", "Spurline is starting. Try again in a moment.");
export const denied = (code: string, message: string): ApiError => new ApiError(403, code, message);
export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);
export const wrongState = (message: string): ApiError => conflict("wrong_state", message);
export const staleHead = (): ApiError => conflict("stale_head", "The source branch changed. Review the new commits and try again.");
export const usernameTaken = (): ApiError => conflict("username_taken", "That username is taken.");
export const idempotencyConflict = (): ApiError =>
  conflict("idempotency_conflict", "This idempotency key was used with a different request.");
export const storageUnavailableMessage = "File storage is unavailable. Uploads, artifacts and exports are paused.";

interface ValidationOptions {
  readonly code?: string;
  readonly message?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

// 422 with `details.fields`; the message is the first field's unless the refusal has its own text.
export function validation(fields: Readonly<Record<string, string>>, options: ValidationOptions = {}): ApiError {
  const message = options.message ?? Object.values(fields)[0] ?? "Invalid request.";
  return new ApiError(422, options.code ?? "validation", message, { ...options.extra, fields });
}

export function validationOne(field: string, message: string): ApiError {
  return validation({ [field]: message });
}

// A 422 with its own error code that names one field.
export const fieldError = (code: string, field: string, message: string): ApiError => validation({ [field]: message }, { code });

// Collects field errors during validation and throws the first one with all fields attached.
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validation(this.fields);
  }
}

export const storageUnavailable = (message: string = storageUnavailableMessage): ApiError =>
  new ApiError(503, "storage_unavailable", message);
