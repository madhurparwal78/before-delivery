import type { ZodError } from "zod";

type ErrorBody = { error: string } & Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

export function apiError(status: number, error: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, { error, ...extra });
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return apiError(422, "validation_failed", { fields });
}

export const notFound = (): ApiError => apiError(404, "not_found");
export const notSignedIn = (): ApiError => apiError(401, "not_signed_in");

// The first message of each field the schema refused.
export function fieldsOf(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "body")] ??= issue.message;
  return fields;
}

export const payloadTooLarge = (): ApiError => apiError(413, "payload_too_large");
