/** The one error shape: { "error": "<code>" } plus the extra keys named for that code. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(String(body.error));
  }
}

export const unauthorized = () => new ApiError(401, { error: "unauthorized" });
export const forbidden = () => new ApiError(403, { error: "forbidden" });
export const notFound = () => new ApiError(404, { error: "not_found" });
export const invalidJson = () => new ApiError(400, { error: "invalid_json" });
export const serviceUnavailable = () => new ApiError(503, { error: "service_unavailable" });
export const payloadTooLarge = () => new ApiError(413, { error: "payload_too_large" });
export const unsupportedMediaType = () => new ApiError(415, { error: "unsupported_media_type" });
export const methodNotAllowed = (allow: string[]) =>
  new ApiError(405, { error: "method_not_allowed" }, { Allow: allow.join(", ") });
export const internal = () => new ApiError(500, { error: "internal" });

/** A refusal with a domain code, e.g. insufficient_funds (400) or payment_not_pending (409). */
export const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, { error: code, ...extra });

const validation = (fields: Record<string, string>) => new ApiError(400, { error: "validation", fields });

/** Collects field messages; throws one validation error naming every failing field. */
export class Fields {
  private readonly messages: Record<string, string> = {};

  fail(field: string, message: string): void {
    if (!(field in this.messages)) this.messages[field] = message;
  }

  failed(field: string): boolean {
    return field in this.messages;
  }

  get any(): boolean {
    return Object.keys(this.messages).length > 0;
  }

  raise(): void {
    if (this.any) throw validation(this.messages);
  }
}
