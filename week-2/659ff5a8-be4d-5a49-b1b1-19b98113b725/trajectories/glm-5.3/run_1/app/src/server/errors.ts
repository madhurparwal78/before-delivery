// The one error shape and published precedence for every API error.
import type { FastifyReply } from "fastify";

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: FieldErrors,
  ) {
    super(message);
  }
}

export function errUnauthenticated(message = "Sign in required."): ApiError {
  return new ApiError(401, "unauthenticated", message);
}
export function errForbidden(message = "You cannot do that."): ApiError {
  return new ApiError(403, "forbidden", message);
}
export function errCrossOrigin(): ApiError {
  return new ApiError(403, "cross_origin", "Cross-origin requests are not allowed.");
}
export function errNotFound(message = "Not found."): ApiError {
  return new ApiError(404, "not_found", message);
}
export function errUnsupportedMedia(): ApiError {
  return new ApiError(415, "unsupported_media_type", "Send JSON.");
}
export function errPayloadTooLarge(): ApiError {
  return new ApiError(413, "payload_too_large", "That request body is too large.");
}
export function errConflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}
export function errValidation(fields: FieldErrors, message = "Fix these fields."): ApiError {
  return new ApiError(422, "validation", message, fields);
}
export function errDependency(code: string, message: string): ApiError {
  return new ApiError(503, code, message);
}

export function sendError(reply: FastifyReply, error: ApiError): void {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.fields && Object.keys(error.fields).length > 0) body.fields = error.fields;
  reply.status(error.status).send(body);
}
