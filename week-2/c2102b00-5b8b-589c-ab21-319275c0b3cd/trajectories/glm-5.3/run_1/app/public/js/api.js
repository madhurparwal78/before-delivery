export class ApiError extends Error {
    status;
    code;
    fields;
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.name = "ApiError";
    }
}
export class NetworkError extends Error {
    constructor() {
        super("No HTTP response");
        this.name = "NetworkError";
    }
}
export async function api(path, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined && !opts.raw)
        headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey)
        headers["Idempotency-Key"] = opts.idempotencyKey;
    if (opts.ifMatch)
        headers["If-Match"] = opts.ifMatch;
    let res;
    try {
        res = await fetch(path, {
            method: opts.method ?? "GET",
            headers,
            body: opts.body,
            credentials: "same-origin",
        });
    }
    catch {
        throw new NetworkError();
    }
    const etag = res.headers.get("ETag");
    if (res.status === 204)
        return { status: 204, data: null, etag };
    let data = null;
    if (res.headers.get("content-type")?.startsWith("application/json")) {
        data = await res.json();
    }
    else {
        data = await res.text();
    }
    if (res.status >= 400) {
        const err = data;
        throw new ApiError(res.status, err?.error?.code ?? "error", err?.error?.message ?? "Something went wrong.", err?.error?.fields);
    }
    return { status: res.status, data: data, etag };
}
export function centsToMoney(cents) {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${neg ? "-" : ""}$${grouped}.${frac}`;
}
export function newIdempotencyKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes)
        out += b.toString(16).padStart(2, "0");
    return out.slice(0, 32);
}
