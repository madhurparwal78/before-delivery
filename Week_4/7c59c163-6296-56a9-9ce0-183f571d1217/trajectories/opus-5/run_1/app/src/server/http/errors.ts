export type FieldErrors = Record<string, string>;

/** Every error response uses the one shape from the API: {"error":"<code>"} plus listed extras. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export class ValidationError extends ApiError {
  constructor(readonly errors: FieldErrors) {
    super(422, 'validation', { errors });
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const invalidField = (field: string): ValidationError => new ValidationError({ [field]: 'invalid' });
