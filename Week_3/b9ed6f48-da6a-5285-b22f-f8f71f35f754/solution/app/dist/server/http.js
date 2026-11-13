// HTTP plumbing: the single error shape, body limits, content types, same-origin writes and a
// small router (brief: API › Error shape, Error precedence, Limits; Server boundary).
import { COPY } from "../shared/copy.js";
const JSON_LIMIT = 65_536;
const UPLOAD_REQUEST_LIMIT = 20_100_000;
export class ApiError extends Error {
    status;
    code;
    fields;
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }
}
export const fail = {
    validation: (fields) => new ApiError(422, "validation_failed", COPY.validation, fields),
    notFound: () => new ApiError(404, "not_found", COPY.notFound),
    unauthenticated: () => new ApiError(401, "unauthenticated", COPY.unauthenticated),
    forbidden: () => new ApiError(403, "forbidden", COPY.forbidden),
    conflict: (code, message) => new ApiError(409, code, message),
    billing: () => new ApiError(503, "billing_unavailable", COPY.billingDown),
    accounts: () => new ApiError(503, "accounts_unavailable", COPY.accountsDown),
    storage: (message = COPY.mediaUnavailable) => new ApiError(503, "storage_unavailable", message),
};
/** Throws a 422 when any field failed. */
export function assertValid(fields) {
    if (Object.keys(fields).length)
        throw fail.validation(fields);
}
export function errorBody(error) {
    return { error: { code: error.code, message: error.message, ...(error.status === 422 ? { fields: error.fields ?? {} } : {}) } };
}
export function send(res, reply) {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...reply.headers };
    if (reply.body === undefined) {
        res.writeHead(reply.status, headers).end();
        return;
    }
    const payload = Buffer.from(JSON.stringify(reply.body));
    res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(payload.length) });
    res.end(payload);
}
export function redirect(location) {
    return { status: 302, headers: { Location: location } };
}
async function readBody(req, limit) {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limit)
        throw new ApiError(413, "payload_too_large", COPY.tooLarge);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit)
            throw new ApiError(413, "payload_too_large", COPY.tooLarge);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
function parseMultipart(body, boundary) {
    const delimiter = Buffer.from(`--${boundary}`);
    const upload = { fields: {}, file: null };
    let start = body.indexOf(delimiter);
    while (start !== -1) {
        const partStart = start + delimiter.length;
        if (body.subarray(partStart, partStart + 2).toString() === "--")
            break;
        const next = body.indexOf(delimiter, partStart);
        if (next === -1)
            break;
        const part = body.subarray(partStart + 2, next - 2);
        const split = part.indexOf("\r\n\r\n");
        const head = part.subarray(0, split).toString("utf8");
        const content = part.subarray(split + 4);
        const name = /name="([^"]*)"/i.exec(head)?.[1];
        const filename = /filename="([^"]*)"/i.exec(head)?.[1];
        const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
        if (name === "file" && filename !== undefined)
            upload.file = { filename, contentType: type.toLowerCase(), data: Buffer.from(content) };
        else if (name)
            upload.fields[name] = content.toString("utf8");
        start = next;
    }
    return upload;
}
function cookies(req) {
    const jar = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const at = part.indexOf("=");
        if (at > 0)
            jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
    }
    return jar;
}
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Limits and content type (413/415), then same-origin writes (403), in the brief's order; a body that
 * does not parse is left for fieldsOf (422). */
export async function prepare(req, url, kind, params) {
    const type = (req.headers["content-type"] ?? "").toLowerCase();
    const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
    let body = {};
    let upload = null;
    if (kind === "json" && hasBody) {
        if (!type.startsWith("application/json"))
            throw new ApiError(415, "unsupported_media_type", COPY.sendJson);
        const raw = await readBody(req, JSON_LIMIT);
        try {
            body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        }
        catch {
            body = undefined;
        }
    }
    else if (kind === "multipart") {
        const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers["content-type"] ?? "");
        if (!type.startsWith("multipart/form-data") || !boundary)
            throw new ApiError(415, "unsupported_media_type", COPY.sendJson);
        upload = parseMultipart(await readBody(req, UPLOAD_REQUEST_LIMIT), boundary[1] ?? boundary[2]);
    }
    else if (hasBody) {
        await readBody(req, JSON_LIMIT);
    }
    const origin = req.headers.origin;
    if (WRITES.has(req.method ?? "") && origin !== undefined && origin !== `http://${req.headers.host}`) {
        throw new ApiError(403, "forbidden_origin", COPY.forbiddenOrigin);
    }
    return { req, url, params, body, upload, cookies: cookies(req) };
}
/** A path parameter that does not decode, or decodes to a control character, names no record. */
function pathParam(raw) {
    try {
        const value = decodeURIComponent(raw);
        return /[\u0000-\u001f\u007f]/.test(value) ? null : value;
    }
    catch {
        return null;
    }
}
export class Router {
    routes = [];
    add(method, path, handler, kind = method === "GET" ? "none" : "json") {
        const keys = [];
        const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key) => (keys.push(key), "([^/]+)"))}$`);
        this.routes.push({ method, pattern, keys, kind, handler });
    }
    match(method, pathname) {
        for (const route of this.routes) {
            if (route.method !== method && !(method === "HEAD" && route.method === "GET"))
                continue;
            const m = route.pattern.exec(pathname);
            if (!m)
                continue;
            const params = {};
            for (const [i, key] of route.keys.entries()) {
                const value = pathParam(m[i + 1]);
                if (value === null)
                    return null;
                params[key] = value;
            }
            return { route, params };
        }
        return null;
    }
}
/** Reads a JSON body as a record of unknown values for field-by-field validation. A body that is
 * not a JSON object is a 422, so handlers call this after their auth, lookup and idempotency checks. */
export function fieldsOf(ctx) {
    const body = ctx.body;
    if (typeof body !== "object" || body === null || Array.isArray(body))
        throw fail.validation({ body: COPY.sendJson });
    return body;
}
