/** The single error shape for every HTTP error and socket error frame. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
  ) {
    super(code);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated');
export const forbidden = () => new ApiError(403, 'forbidden');
export const notFound = () => new ApiError(404, 'not_found');
export const conflict = (code: string) => new ApiError(409, code);
export const invalid = (fields: Record<string, string>) => new ApiError(422, 'invalid', fields);
export const crossOrigin = () => new ApiError(403, 'cross_origin');
export const unsupportedMediaType = () => new ApiError(415, 'unsupported_media_type');
export const tooLarge = () => new ApiError(413, 'too_large');
export const storageUnavailable = () => new ApiError(503, 'storage_unavailable');
export const starting = () => new ApiError(503, 'starting');

export function errorBody(err: ApiError): { error: string; fields?: Record<string, string> } {
  return err.fields ? { error: err.code, fields: err.fields } : { error: err.code };
}
