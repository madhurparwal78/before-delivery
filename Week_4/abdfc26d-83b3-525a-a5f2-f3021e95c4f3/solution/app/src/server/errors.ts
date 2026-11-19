// The one error type. Every API error leaves the server as
// {"error":{"code","message",...extra}} with "fields" only on 422.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }

  get body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}), ...this.extra } };
  }
}

export const payloadTooLarge = () => new ApiError(413, "payload_too_large", "The request body is too large.");
export const unsupportedMediaType = () => new ApiError(415, "unsupported_media_type", "Send JSON, or multipart/form-data for uploads.");
export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const notFound = () => new ApiError(404, "not_found", "Not found.");
export const forbidden = () => new ApiError(403, "forbidden", "Your account cannot do this.");
export const invalidTransition = (message = "That change is not allowed in this state.") =>
  new ApiError(409, "invalid_transition", message);
export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(409, code, message, extra);
export const validationFailed = (fields: Record<string, string>) =>
  new ApiError(422, "validation_failed", "Check the highlighted fields.", {}, fields);

/** The provider a failure came from; each route maps it to its published 503 or 502. */
type Provider = "killbill" | "minio" | "provider" | "gotenberg" | "mail" | "keycloak";

/** Thrown by a provider client when the provider is unreachable, times out or answers 5xx. */
export class ProviderDown extends Error {
  constructor(readonly provider: Provider, detail: string, readonly timedOut = false) {
    super(`${provider} unavailable: ${detail}`);
  }
}

export const paymentsUnavailable = () =>
  new ApiError(503, "payments_unavailable", "Payments are offline right now.");
export const storageUnavailable = () =>
  new ApiError(503, "storage_unavailable", "File storage is offline right now.");

/** Turns a provider outage into the route's published 503; anything else passes through. */
export async function during<T>(provider: Provider, outage: () => ApiError, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProviderDown && error.provider === provider) throw outage();
    throw error;
  }
}
