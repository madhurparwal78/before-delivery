import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: { error: string } & Record<string, unknown>,
  ) {
    super(body.error);
  }
}

export const unauthenticated = () => new ApiError(401, { error: "unauthenticated" });
export const notFound = () => new ApiError(404, { error: "not_found" });
export const forbidden = () => new ApiError(403, { error: "forbidden" });
export const invalidState = (status: string) => new ApiError(409, { error: "invalid_state", status });
export const linkClosed = (state: string) => new ApiError(409, { error: "link_closed", state });
export const storageUnavailable = () => new ApiError(503, { error: "storage_unavailable" });
export const mailUnavailable = () => new ApiError(503, { error: "mail_unavailable" });

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, { error: "validation", fields });
}

export class StorageError extends Error {}
export class MailError extends Error {}

export const badRequestBody = () => new ApiError(400, { error: "bad_request" });
