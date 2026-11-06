// One error shape and one precedence order for the whole API.

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(status: number, body: Record<string, unknown>, headers?: Record<string, string>) {
    super(typeof body.error === "string" ? body.error : `http_${status}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError(422, { errors: fields });
}

export const errors = {
  unauthenticated: () => new ApiError(401, { error: "unauthenticated" }),
  forbidden: () => new ApiError(403, { error: "forbidden" }),
  crossOrigin: () => new ApiError(403, { error: "cross_origin" }),
  payloadTooLarge: () => new ApiError(413, { error: "payload_too_large" }),
  unsupportedMediaType: () => new ApiError(415, { error: "unsupported_media_type" }),
  notFound: () => new ApiError(404, { error: "not_found" }),
  versionRequired: () => new ApiError(428, { error: "version_required" }),
  staleVersion: (current: number) => new ApiError(412, { error: "stale_version", current_version: current }),
  conflict: (code: string, extra?: Record<string, unknown>) => new ApiError(409, { error: code, ...extra }),
  paymentUnavailable: () => new ApiError(503, { error: "payment_unavailable" }),
  storageUnavailable: () => new ApiError(503, { error: "storage_unavailable" }),
};
