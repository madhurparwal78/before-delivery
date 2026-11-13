/** The one error builder: every error answer in the app is made here. */

type ErrorExtra = Record<string, number | string | Record<string, string>>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    extra: ErrorExtra = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

export function errorBody(error: ApiError): Record<string, unknown> {
  return { error: error.code, ...error.extra };
}

export const notFound = (): ApiError => new ApiError(404, "not_found");
export const landmarkNotFound = (): ApiError => new ApiError(404, "landmark_not_found");
export const subscriberNotFound = (): ApiError => new ApiError(404, "subscriber_not_found");
export const readOnly = (): ApiError =>
  new ApiError(405, "read_only", {}, { Allow: "GET, HEAD" });
export const methodNotAllowed = (allow: string): ApiError =>
  new ApiError(405, "method_not_allowed", {}, { Allow: allow });
export const bodyTooLarge = (limit: number): ApiError =>
  new ApiError(413, "body_too_large", { limit_bytes: limit });
export const captureTooLarge = (): ApiError =>
  new ApiError(413, "capture_too_large", { limit_bytes: 5_000_000 });
export const unsupportedMediaType = (): ApiError => new ApiError(415, "unsupported_media_type");
export const invalidJson = (): ApiError => new ApiError(400, "invalid_json");
export const validation = (errors: Record<string, string>): ApiError =>
  new ApiError(422, "validation", { errors });
export const conflict = (code: string, extra: ErrorExtra = {}): ApiError =>
  new ApiError(409, code, extra);
export const gone = (code: string): ApiError => new ApiError(410, code);
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable");
export const searchUnavailable = (): ApiError => new ApiError(503, "search_unavailable");
export const rendererUnavailable = (): ApiError => new ApiError(503, "renderer_unavailable");
export const billingUnavailable = (): ApiError => new ApiError(503, "billing_unavailable");
export const webhooksUnavailable = (): ApiError => new ApiError(503, "webhooks_unavailable");
export const rateLimited = (headers: Record<string, string>): ApiError =>
  new ApiError(429, "rate_limited", {}, headers);
export const preconditionFailed = (): ApiError => new ApiError(412, "precondition_failed");
export const rangeNotSatisfiable = (size: number): ApiError =>
  new ApiError(416, "range_not_satisfiable", {}, { "Content-Range": `bytes */${size}` });
export const internalError = (): ApiError => new ApiError(500, "internal_error");

/** Thrown by a dependency client when the service cannot be used at all. */
export class DependencyDown extends Error {
  readonly service: "storage" | "search" | "queue" | "cache" | "renderer" | "billing" | "webhooks";

  constructor(service: DependencyDown["service"], message: string) {
    super(`${service} unavailable: ${message}`);
    this.service = service;
  }
}
