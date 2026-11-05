export class AppError extends Error {
    status;
    code;
    fields;
    extra;
    constructor(status, code, message, fields, extra) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.extra = extra;
    }
}
export function errorBody(err) {
    const body = { error: err.code, message: err.message };
    if (err.fields)
        body.fields = err.fields;
    if (err.extra)
        Object.assign(body, err.extra);
    return body;
}
export function sendError(res, err) {
    res.status(err.status).json(errorBody(err));
}
export const unauthenticated = () => new AppError(401, "unauthenticated", "Sign in first.");
export const forbidden = () => new AppError(403, "forbidden", "Your role can't do that.");
export const notFound = () => new AppError(404, "not_found", "Not found.");
export const methodNotAllowed = () => new AppError(405, "method_not_allowed", "Method not allowed.");
export const crossOrigin = () => new AppError(403, "cross_origin", "Cross-origin request refused.");
export const tooLarge = () => new AppError(413, "too_large", "Body too large.");
export const unsupportedType = () => new AppError(415, "unsupported_type", "Unsupported content type.");
export function validationError(fields) {
    return new AppError(422, "validation_failed", "Check these fields", fields);
}
export function conflict(code, message, extra) {
    return new AppError(409, code, message, undefined, extra);
}
export function serviceUnavailable(code, message, extra) {
    return new AppError(503, code, message, undefined, extra);
}
export function fieldError(key, message) {
    return validationError({ [key]: message });
}
// Error precedence: this is the single place errors map to a response.
export function errorHandler(err, req, res, _next) {
    if (err instanceof AppError) {
        sendError(res, err);
        return;
    }
    if (err instanceof Error) {
        res.status(500).json({ error: "internal", message: "Something went wrong." });
        return;
    }
    res.status(500).json({ error: "internal", message: "Something went wrong." });
}
