/** Typed JSON fetch helpers shared by all pages. */
export async function jsonFetch(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = null;
    if (text.length > 0) {
        try {
            body = JSON.parse(text);
        }
        catch {
            body = null;
        }
    }
    return { status: response.status, body, headers: response.headers, ok: response.ok };
}
export class ApiError extends Error {
    status;
    code;
    extras;
    constructor(status, code, message, extras = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extras = extras;
    }
}
export async function apiFetch(url, options = {}) {
    const result = await jsonFetch(url, options);
    if (result.status >= 400) {
        const payload = (result.body || {});
        throw new ApiError(result.status, payload.error || "unknown", payload.message || "Something went wrong.", (payload || {}));
    }
    return result.body;
}
/** A request that ends with no HTTP response at all (connection lost). */
export class NoResponseError extends Error {
    constructor() {
        super("The request ended without a response.");
    }
}
export async function fetchOrNoResponse(url, options) {
    try {
        return await fetch(url, options);
    }
    catch (error) {
        if (error instanceof TypeError) {
            throw new NoResponseError();
        }
        throw error;
    }
}
