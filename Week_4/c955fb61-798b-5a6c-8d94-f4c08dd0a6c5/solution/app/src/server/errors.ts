/** Every API error is thrown as an ApiError and answered by `errorBody`: `{"error": "<code>", ...extra}`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function errorBody(error: ApiError): Record<string, unknown> {
  return { error: error.code, ...error.extra };
}

export const notFound = () => new ApiError(404, "not_found");
export const readOnly = () => new ApiError(403, "read_only");
export const invalidField = (field: string) => new ApiError(422, "invalid_field", { field });
