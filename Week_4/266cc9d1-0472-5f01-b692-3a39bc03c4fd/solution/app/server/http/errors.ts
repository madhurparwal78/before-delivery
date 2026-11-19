// The one API error shape: {"error":{"code","message", ...extra}}.

interface ErrorExtra {
  fields?: Record<string, string>;
  from?: string;
  action?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(message);
  }

  body(): { error: { code: string; message: string } & ErrorExtra } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

const STORAGE_UNREACHABLE_MESSAGE = "Tile storage is unreachable.";

export const fail = {
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "The request body is too large."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Send the request body as application/json."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in with your access code."),
  invalidAccessCode: () => new ApiError(401, "invalid_access_code", "That access code is not recognised."),
  linkNotFound: () => new ApiError(404, "link_not_found", "This review link does not exist."),
  linkRevoked: () => new ApiError(410, "link_revoked", "This review link has been withdrawn."),
  linkExpired: () => new ApiError(410, "link_expired", "This review link has expired."),
  idempotencyConflict: () =>
    new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request body."),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  forbidden: () => new ApiError(403, "forbidden", "Your role cannot do this."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Requests that change data must come from this site."),
  conflict: (code: string, message: string, extra: ErrorExtra = {}) => new ApiError(409, code, message, extra),
  validation: (fields: Record<string, string>) =>
    new ApiError(422, "validation_failed", "Some fields need attention.", { fields }),
  checksumMismatch: (field: "size_bytes" | "sha256") => {
    const message = field === "size_bytes" ? "Bytes did not match the declared size." : "Bytes did not match the declared SHA-256.";
    return new ApiError(422, "checksum_mismatch", message, { fields: { [field]: message } });
  },
  invalidCzml: () => new ApiError(422, "invalid_czml", "The flight track has no position samples with an epoch and availability."),
  rangeNotSatisfiable: () => new ApiError(416, "range_not_satisfiable", "The requested byte range is outside the file."),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", STORAGE_UNREACHABLE_MESSAGE),
};
