import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { StorageUnavailable } from "./storage.js";
const JSON_LIMIT = 2_000_000;
const ZIP_LIMIT = 5_000_000;
export const FRAME_LIMIT = 2_000_000;
export const COOKIE = "rb_session";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const routes = [];
export function route(method, path, handler, options = {}) {
    const keys = [];
    const source = path.replace(/:([a-z_]+)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
    });
    routes.push({
        method,
        pattern: new RegExp(`^${source}$`),
        keys,
        body: options.body ?? "json",
        auth: options.auth ?? true,
        private: options.private ?? false,
        handler,
    });
}
export const ok = (body, status = 200) => ({ status, body });
export const noContent = (headers) => ({ status: 204, headers });
export const PRIVATE_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex",
};
export function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
export function newToken() {
    return randomBytes(32).toString("base64url");
}
export function cookies(req) {
    const jar = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0)
            jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return jar;
}
export function sessionCookie(token) {
    const secure = config.publicUrl.startsWith("https:") ? "; Secure" : "";
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}
export function clearedCookie() {
    return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
export async function userFromCookie(req) {
    const token = cookies(req)[COOKIE];
    if (!token)
        return null;
    return ((await one(pool, `SELECT u.id, u.email, u.name, u.kind FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [hashToken(token)])) ?? null);
}
export function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    const host = req.headers.host;
    return origin === config.publicOrigin || (host !== undefined && (origin === `http://${host}` || origin === `https://${host}`));
}
function send(res, reply, extra = {}) {
    const headers = { ...extra, ...reply.headers };
    if (reply.body === undefined) {
        res.writeHead(reply.status, headers);
        res.end();
        return;
    }
    const payload = Buffer.from(JSON.stringify(reply.body), "utf8");
    res.writeHead(reply.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(payload.length),
        "Cache-Control": "no-store",
        ...headers,
    });
    res.end(payload);
}
function readBody(req, limit) {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > limit)
        return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let over = false;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit)
                over = true;
            if (!over)
                chunks.push(chunk);
        });
        req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
        req.on("error", reject);
    });
}
function mediaType(req) {
    return (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}
/** Sends any failure in the catalogued error shape. */
export function sendError(res, error, extra = {}) {
    send(res, errorReply(error), extra);
}
function errorReply(error) {
    if (error instanceof ApiError)
        return { status: error.status, body: error.body() };
    if (!(error instanceof StorageUnavailable))
        console.error(error);
    const unavailable = new ApiError("storage_unavailable");
    return { status: unavailable.status, body: unavailable.body() };
}
/** Answers an /api/ request, applying the brief's error precedence before the handler runs. */
export async function dispatch(req, res, url) {
    const method = req.method ?? "GET";
    let matched;
    let values = [];
    let getOnly = false;
    for (const candidate of routes) {
        const hit = candidate.pattern.exec(url.pathname);
        if (!hit)
            continue;
        if (candidate.private)
            getOnly = true;
        if (candidate.method === method) {
            matched = candidate;
            values = hit.slice(1);
            break;
        }
    }
    if (!matched && getOnly) {
        req.resume();
        send(res, errorReply(new ApiError("method_not_allowed")), PRIVATE_HEADERS);
        return;
    }
    if (!matched) {
        req.resume();
        send(res, errorReply(new ApiError("not_found")));
        return;
    }
    const current = matched;
    const extra = current.private ? PRIVATE_HEADERS : {};
    try {
        const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
        const wanted = current.body === "zip" ? "application/zip" : "application/json";
        if ((hasBody || current.body === "zip") && mediaType(req) !== wanted) {
            req.resume();
            throw new ApiError("unsupported_media_type");
        }
        const limit = current.body === "zip" ? ZIP_LIMIT : JSON_LIMIT;
        const raw = await readBody(req, limit);
        if (raw === null)
            throw new ApiError("too_large", { limit_bytes: limit });
        const params = {};
        current.keys.forEach((key, i) => (params[key] = decodeURIComponent(values[i])));
        let user = null;
        if (current.auth) {
            user = await userFromCookie(req);
            if (!user)
                throw new ApiError("unauthenticated");
        }
        for (const [key, value] of Object.entries(params)) {
            if (key !== "token" && !UUID.test(value))
                throw new ApiError("not_found");
        }
        if (method !== "GET" && method !== "HEAD" && !sameOrigin(req))
            throw new ApiError("cross_origin");
        let parsed;
        const ctx = {
            req,
            url,
            params,
            user: user,
            raw,
            header: (name) => {
                const value = req.headers[name.toLowerCase()];
                return Array.isArray(value) ? value[0] : value;
            },
            json: () => {
                if (parsed)
                    return parsed;
                if (raw.length === 0)
                    return (parsed = {});
                let value;
                try {
                    value = JSON.parse(raw.toString("utf8"));
                }
                catch {
                    throw invalid({ body: "The body must be a JSON object." });
                }
                if (typeof value !== "object" || value === null || Array.isArray(value)) {
                    throw invalid({ body: "The body must be a JSON object." });
                }
                return (parsed = value);
            },
        };
        send(res, await current.handler(ctx), extra);
    }
    catch (error) {
        send(res, errorReply(error), extra);
    }
}
