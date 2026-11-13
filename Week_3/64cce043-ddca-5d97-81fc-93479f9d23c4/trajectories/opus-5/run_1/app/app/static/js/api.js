// The JSON API client. Every failure arrives as an ApiError carrying the published code.

export const FAILED_REQUEST = 'Something went wrong. Your change was not saved.';

export class ApiError extends Error {
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields || null;
    }

    get isSignedOut() {
        return this.code === 'signed_out';
    }

    get isAccessEnded() {
        return this.code === 'access_ended';
    }

    // A failure with no published body: a network drop or a 500.
    get isUnexplained() {
        return this.code === 'request_failed' || this.code === 'internal';
    }
}

// The server's own clock, read from the Date header of its answers.
let serverClock = null;

export function serverToday() {
    const moment = serverClock || new Date();
    return moment.toISOString().slice(0, 10);
}

async function request(method, path, { body, idempotencyKey } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
        response = await fetch(path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: 'same-origin',
        });
    } catch (cause) {
        throw new ApiError(0, 'request_failed', FAILED_REQUEST);
    }
    const served = response.headers.get('date');
    if (served) serverClock = new Date(served);
    if (response.status === 204) return null;
    let payload = null;
    try {
        payload = await response.json();
    } catch (cause) {
        payload = null;
    }
    if (response.ok) return payload;
    const error = payload && payload.error;
    if (!error) throw new ApiError(response.status, 'request_failed', FAILED_REQUEST);
    throw new ApiError(response.status, error.code, error.message, error.fields);
}

export const api = {
    get: (path) => request('GET', path),
    post: (path, body, options) => request('POST', path, { body, ...options }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    delete: (path) => request('DELETE', path),
};

export function newIdempotencyKey() {
    return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
}

export function filterQuery(filters) {
    // Keys appear in the published order and empty values are left out.
    const query = new URLSearchParams();
    for (const key of ['q', 'company', 'data_kind', 'level']) {
        if (filters[key]) query.set(key, filters[key]);
    }
    const text = query.toString();
    return text ? `?${text}` : '';
}
