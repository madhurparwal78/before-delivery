export const JSON_LIMIT = 64_000;
export const UPLOAD_LIMIT = 5_100_000;
/** The one published error shape: {"error","message"} plus optional fields. */
export class ApiError extends Error {
    status;
    code;
    extra;
    constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}
export const validation = (fields) => new ApiError(422, "validation", "Check the highlighted fields.", { fields });
export const notFound = () => new ApiError(404, "not_found", "We couldn't find that.");
const STORE_DOWN = "The shop can't update right now. Try again in a moment.";
export const storeUnavailable = () => new ApiError(503, "store_unavailable", STORE_DOWN);
export const accountsUnavailable = () => new ApiError(503, "accounts_unavailable", "Accounts are unreachable right now. Try again in a moment.");
export const filesUnavailable = () => new ApiError(503, "files_unavailable", "File storage is unreachable right now. Try again shortly.");
export const billingUnavailable = (message = "Billing is unreachable right now. Try again shortly.") => new ApiError(503, "billing_unavailable", message);
/** Sends a JSON body (any serialisable value the handlers built), or an empty body for 204. */
export function sendJson(res, status, body) {
    if (body === undefined) {
        res.writeHead(status, { "Cache-Control": "no-store" });
        res.end();
        return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
    });
    res.end(payload);
}
export function errorBody(error) {
    return { error: error.code, message: error.message, ...error.extra };
}
export function sendError(res, error) {
    sendJson(res, error.status, errorBody(error));
}
export function cookies(req) {
    const jar = new Map();
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const at = part.indexOf("=");
        if (at > 0)
            jar.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
    }
    return jar;
}
export function setCookie(res, name, value, maxAgeSeconds) {
    const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
    const existing = res.getHeader("Set-Cookie");
    const list = Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)];
    res.setHeader("Set-Cookie", [...list, cookie]);
}
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** 403 cross_origin when a state-changing request names another origin than http://<Host>. */
export function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!STATE_CHANGING.has(req.method ?? "") || origin === undefined)
        return;
    if (origin !== `http://${req.headers.host ?? ""}`) {
        throw new ApiError(403, "cross_origin", "Requests must come from this shop's own pages.");
    }
}
export async function readBody(req, limit) {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limit) {
        req.resume();
        throw tooLarge();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const piece = chunk;
        size += piece.length;
        if (size > limit)
            throw tooLarge();
        chunks.push(piece);
    }
    return Buffer.concat(chunks);
}
export const tooLarge = () => new ApiError(413, "too_large", "That request is too large.");
export const unsupportedType = (message = "Send this request as JSON.") => new ApiError(415, "unsupported_type", message);
/** Reads a JSON body: 413 first, then 415, then a 422 for malformed JSON. */
export async function readJson(req) {
    const raw = await readBody(req, JSON_LIMIT);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (raw.length === 0 && type === "")
        return {};
    if (type !== "application/json")
        throw unsupportedType();
    if (raw.length === 0)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw.toString("utf8"));
    }
    catch {
        throw validation({ body: "Send a JSON object." });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw validation({ body: "Send a JSON object." });
    }
    return parsed;
}
/** A buffered multipart/form-data parser for the one upload endpoint. */
export function parseMultipart(raw, contentType) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!match)
        throw unsupportedType("Send the application as multipart/form-data.");
    const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
    const result = { fields: new Map(), files: new Map() };
    let at = raw.indexOf(boundary);
    while (at !== -1) {
        const start = at + boundary.length;
        if (raw.subarray(start, start + 2).toString() === "--")
            break;
        const headerEnd = raw.indexOf("\r\n\r\n", start);
        if (headerEnd === -1)
            break;
        const next = raw.indexOf(boundary, headerEnd);
        if (next === -1)
            break;
        const headers = raw.subarray(start + 2, headerEnd).toString("utf8");
        const data = raw.subarray(headerEnd + 4, next - 2);
        const name = /name="([^"]*)"/i.exec(headers)?.[1];
        const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
        if (name !== undefined) {
            if (filename !== undefined) {
                const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
                result.files.set(name, { filename, type, data: Buffer.from(data) });
            }
            else {
                result.fields.set(name, data.toString("utf8"));
            }
        }
        at = next;
    }
    return result;
}
export function str(body, key) {
    const value = body[key];
    return typeof value === "string" ? value : undefined;
}
export function int(body, key) {
    const value = body[key];
    return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
export function bool(body, key) {
    const value = body[key];
    return typeof value === "boolean" ? value : undefined;
}
