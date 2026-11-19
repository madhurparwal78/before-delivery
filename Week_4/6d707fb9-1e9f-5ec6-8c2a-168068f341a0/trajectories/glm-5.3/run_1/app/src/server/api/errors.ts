/** One error shape for every endpoint. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    lastValue?: string;
    lastAt?: string;
    busyUntil?: string;
  };
}

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly extra?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: FieldErrors; extra?: Record<string, string>; headers?: Record<string, string> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.extra = options?.extra;
    this.headers = options?.headers;
  }

  body(): ErrorBody {
    const err: ErrorBody["error"] = { code: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length > 0) err.fields = this.fields;
    if (this.extra) Object.assign(err, this.extra);
    return { error: err };
  }
}

export function errNotFound(message = `We couldn't find that page.`): ApiError {
  return new ApiError(404, "not_found", message);
}

export function errMethodNotAllowed(allow: string[]): ApiError {
  return new ApiError(405, "method_not_allowed", `That method isn't allowed here.`, {
    headers: { Allow: allow.join(", ") },
  });
}

export function errTooLarge(): ApiError {
  return new ApiError(413, "too_large", `That request is too large.`);
}

export function errRateLimited(retryAfter: number, message: string): ApiError {
  return new ApiError(429, "rate_limited", message, {
    headers: { "Retry-After": String(retryAfter) },
  });
}

export function errInvalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", `That email and password don't match.`);
}

export function errNotSignedIn(): ApiError {
  return new ApiError(401, "not_signed_in", `Sign in first.`);
}

export function errSessionEnded(): ApiError {
  return new ApiError(401, "session_ended", `Your session ended. Sign in again to keep going \u2014 what you typed is still here.`);
}

export function errPageEnded(message: string): ApiError {
  return new ApiError(410, "page_ended", message);
}

export function errWithdrawn(message: string): ApiError {
  return new ApiError(410, "withdrawn", message);
}

export function errUnsupportedMediaType(): ApiError {
  return new ApiError(415, "unsupported_media_type", `That content type isn't supported.`);
}

export function errMalformedJson(): ApiError {
  return new ApiError(400, "malformed_json", `That body isn't valid JSON.`);
}

export function errValidation(fields: FieldErrors): ApiError {
  const first = Object.entries(fields)[0];
  return new ApiError(422, "validation_failed", first?.[1] ?? `Give a value here.`, { fields });
}

export function errValidationMessage(message: string): ApiError {
  return new ApiError(422, "validation_failed", message);
}

export function errConflict(message: string, extra?: Record<string, string>): ApiError {
  return new ApiError(409, "conflict", message, { extra });
}

export function errEmailTaken(): ApiError {
  return new ApiError(409, "email_taken", `That email already has a desk.`);
}

export function errKeyReused(): ApiError {
  return new ApiError(409, "key_reused", `That request key was already used.`);
}

export function errLowerReading(lastValue: string, lastAt: string, message: string): ApiError {
  return new ApiError(409, "lower_reading", message, { extra: { lastValue, lastAt } });
}

export function errGtinTaken(): ApiError {
  return new ApiError(409, "gtin_taken", `A passport with this GTIN already exists.`);
}

export function errNewerDossier(message: string): ApiError {
  return new ApiError(409, "newer_dossier", message);
}

export function errStaleEdit(message: string): ApiError {
  return new ApiError(412, "stale_edit", message);
}

export function errLibraryUnavailable(message: string): ApiError {
  return new ApiError(503, "factor_library_unavailable", message);
}

export function errScoreUnavailable(message: string): ApiError {
  return new ApiError(503, "score_service_unavailable", message);
}

export function errScoreBusy(message: string, busyUntil: string): ApiError {
  return new ApiError(503, "score_service_busy", message, { extra: { busyUntil } });
}

export function errFileStoreUnavailable(): ApiError {
  return new ApiError(503, "file_store_unavailable", `The file store is unavailable right now. Nothing was saved.`);
}

export function errDossierUnavailable(): ApiError {
  return new ApiError(503, "dossier_service_unavailable", `The dossier service is unavailable right now. Nothing was saved.`);
}
