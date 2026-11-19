import type { JsonObject } from './json.js';
import { msg } from './messages.js';

/** Every refusal the API sends is one of these; `errorBody` is the only place a body is built. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: JsonObject = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorBody(error: ApiError): JsonObject {
  return { error: error.message, ...error.extra };
}

export const refuse = {
  signIn: () => new ApiError(401, msg.signInRequired),
  notFound: () => new ApiError(404, msg.notFound),
  viewer: () => new ApiError(403, msg.viewerRefused),
  ownerOnly: () => new ApiError(403, msg.ownerOnly),
  crossOrigin: () => new ApiError(403, msg.crossOrigin),
  conflict: (message: string, extra: JsonObject = {}) => new ApiError(409, message, extra),
  invalid: (message: string, extra: JsonObject = {}) => new ApiError(422, message, extra),
  field: (message: string, field: string) => new ApiError(422, message, { field }),
  unavailable: (message: string) => new ApiError(503, message),
  tooLarge: (limit: number) => new ApiError(413, msg.bodyTooLarge(limit)),
  unsupported: (message: string) => new ApiError(415, message),
  wrongPassword: () => new ApiError(401, msg.wrongCredentials),
  forbidden: (message: string) => new ApiError(403, message),
  internal: () => new ApiError(500, msg.internal),
  emailExists: () => new ApiError(409, msg.emailExists),
  notAllowed: () => new ApiError(405, msg.methodNotAllowed, {}, { allow: 'POST' }),
};

