// The one published error shape and precedence for the whole API.
export class ApiError extends Error {
    status;
    body;
    constructor(status, code, extra = {}) {
        super(code);
        this.status = status;
        this.body = { error: code, ...extra };
    }
}
export const tooLarge = () => new ApiError(413, 'too_large');
export const unsupportedMediaType = () => new ApiError(415, 'unsupported_media_type');
export const badOrigin = () => new ApiError(403, 'bad_origin');
export const unauthenticated = () => new ApiError(401, 'unauthenticated');
export const notFound = () => new ApiError(404, 'not_found');
export const readOnly = () => new ApiError(403, 'read_only');
export const serverError = () => new ApiError(500, 'server_error');
export function invalidField(field) {
    return new ApiError(422, 'invalid_field', { field });
}
