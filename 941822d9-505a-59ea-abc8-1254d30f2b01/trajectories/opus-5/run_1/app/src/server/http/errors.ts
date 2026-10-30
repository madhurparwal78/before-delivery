/** The one error shape: `{"error":"<code>"}` with named extras, or a 422 field map. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

export function apiError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(status, { error: code, ...extra });
}

export const methodNotAllowed = (): ApiError => apiError(405, 'method_not_allowed');
export const payloadTooLarge = (): ApiError => apiError(413, 'payload_too_large');
export const unsupportedMediaType = (): ApiError => apiError(415, 'unsupported_media_type');
export const invalidJson = (): ApiError => apiError(400, 'invalid_json');
export const crossOrigin = (): ApiError => apiError(403, 'cross_origin');
export const unauthenticated = (): ApiError => apiError(401, 'unauthenticated');
export const notFound = (): ApiError => apiError(404, 'not_found');
export const forbidden = (): ApiError => apiError(403, 'forbidden');
export const versionRequired = (): ApiError => apiError(428, 'version_required');
export const staleVersion = (currentVersion: number): ApiError =>
  apiError(412, 'stale_version', { current_version: currentVersion });
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  apiError(409, code, extra);

export const UNACCEPTED_FIELD_MESSAGE = 'This field is not accepted.';

/** Collects every invalid and unaccepted field so one 422 reports them all at once. */
export class Validator {
  private readonly errors = new Map<string, string>();

  constructor(body: Record<string, unknown> | null, accepted: readonly string[]) {
    if (body !== null) {
      for (const field of Object.keys(body)) {
        if (!accepted.includes(field)) this.errors.set(field, UNACCEPTED_FIELD_MESSAGE);
      }
    }
  }

  add(field: string, message: string): void {
    if (!this.errors.has(field)) this.errors.set(field, message);
  }

  throwIfInvalid(): void {
    if (this.errors.size === 0) return;
    throw new ApiError(422, { errors: Object.fromEntries(this.errors) });
  }
}
