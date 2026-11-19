export class ApiError extends Error {
    status;
    code;
    fields;
    constructor(status, code, fields) {
        super(code);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }
}
async function request(method, path, body, idempotencyKey, raw) {
    const headers = {};
    if (body !== undefined && !(body instanceof FormData))
        headers['Content-Type'] = 'application/json';
    if (idempotencyKey)
        headers['Idempotency-Key'] = idempotencyKey;
    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) {
        init.body = body instanceof FormData ? body : JSON.stringify(body);
    }
    const res = await fetch(path, init);
    if (raw) {
        return { status: res.status, blob: await res.blob() };
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const err = data;
        throw new ApiError(res.status, err?.error ?? `http_${res.status}`, err?.errors ?? null);
    }
    return data;
}
export const api = {
    get: (path) => request('GET', path),
    post: (path, body, idempotencyKey) => request('POST', path, body, idempotencyKey),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
    postRaw: (path, body) => request('POST', path, body, undefined, true),
};
export async function downloadFile(path, filename) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok)
        throw new ApiError(res.status, 'download_failed', null);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
