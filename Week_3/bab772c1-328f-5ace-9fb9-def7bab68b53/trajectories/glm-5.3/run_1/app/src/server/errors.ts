// The single error builder. Every error response, including unknown routes,
// 405, 413, 415, unexpected failures and 503 outage answers, is built here.

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly fields: FieldErrors | null;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    options: { extra?: Record<string, unknown>; fields?: FieldErrors; headers?: Record<string, string> } = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = options.extra ?? {};
    this.fields = options.fields ?? null;
    this.headers = options.headers ?? {};
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    for (const [k, v] of Object.entries(this.extra)) {
      body[k] = v;
    }
    if (this.fields !== null && Object.keys(this.fields).length > 0) {
      body.errors = this.fields;
    }
    return body;
  }
}

export function notFound(code = "not_found", extra?: Record<string, unknown>): ApiError {
  return new ApiError(404, code, { extra });
}

export function methodNotAllowed(allow: string): ApiError {
  return new ApiError(405, "method_not_allowed", { headers: { Allow: allow } });
}

export function readOnly(allow: string): ApiError {
  return new ApiError(405, "read_only", { headers: { Allow: allow } });
}

export function bodyTooLarge(limitBytes: number, capture = false): ApiError {
  if (capture) {
    return new ApiError(413, "capture_too_large", { extra: { limit_bytes: limitBytes } });
  }
  return new ApiError(413, "body_too_large", { extra: { limit_bytes: limitBytes } });
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, "unsupported_media_type");
}

export function invalidJson(): ApiError {
  return new ApiError(400, "invalid_json");
}

export function conflict(code: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(409, code, { extra });
}

export function validation(fields: FieldErrors): ApiError {
  return new ApiError(422, "validation", { fields });
}

export function outage(dependency: OutageCode): ApiError {
  return new ApiError(503, `${dependency}_unavailable`);
}

export type OutageCode = "storage" | "search" | "renderer" | "billing" | "webhooks" | "queue" | "cache";

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "rate_limited", {
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

export function gone(code: string): ApiError {
  return new ApiError(410, code);
}

export function firstFieldMessage(error: ApiError, order: string[]): string {
  if (!error.fields) return "";
  for (const field of order) {
    if (error.fields[field]) return error.fields[field];
  }
  for (const value of Object.values(error.fields)) {
    return value;
  }
  return "";
}
