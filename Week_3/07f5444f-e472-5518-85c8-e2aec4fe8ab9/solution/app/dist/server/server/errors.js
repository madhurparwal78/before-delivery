// The one error shape every API refusal goes through: {"error","message"} plus the stated extras.
export class ApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(body.message);
        this.status = status;
        this.body = body;
    }
}
export const unauthenticated = () => new ApiError(401, { error: "unauthenticated", message: "Sign in to continue." });
export const notFound = () => new ApiError(404, { error: "not_found", message: "Nothing was found at that address." });
export const forbidden = () => new ApiError(403, { error: "forbidden", message: "Your role can't take this action." });
export const conflict = (error, message, extra = {}) => new ApiError(409, { error, message, ...extra });
export const invalid = (errors) => new ApiError(422, { error: "validation", message: "Check the highlighted fields.", errors });
export const programmeClosed = () => conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");
export const storageUnavailable = () => new ApiError(503, { error: "storage_unavailable", message: "The score store is offline." });
/** Collects field messages and throws one 422 when any were added. */
export class FieldErrors {
    errors = {};
    add(field, message) {
        this.errors[field] ??= message;
    }
    any() {
        return Object.keys(this.errors).length > 0;
    }
    throwIfAny() {
        if (this.any())
            throw this.error();
    }
    error() {
        return invalid(this.errors);
    }
}
