"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WrongContentType = exports.BodyTooLarge = exports.MAX_UPLOAD_BYTES = exports.MAX_JSON_BYTES = void 0;
exports.parseCookies = parseCookies;
exports.viewerOf = viewerOf;
exports.readJsonBody = readJsonBody;
exports.readRawBody = readRawBody;
exports.originAllowed = originAllowed;
exports.sendJson = sendJson;
exports.sendError = sendError;
exports.etagOf = etagOf;
exports.parseIfMatch = parseIfMatch;
const errors_1 = require("../errors");
const db_1 = require("../db");
exports.MAX_JSON_BYTES = 16384;
exports.MAX_UPLOAD_BYTES = 10000000;
class BodyTooLarge extends Error {
}
exports.BodyTooLarge = BodyTooLarge;
class WrongContentType extends Error {
}
exports.WrongContentType = WrongContentType;
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0)
            continue;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}
function viewerOf(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies["tally_session"];
    if (!token)
        return null;
    const row = (0, db_1.one)("SELECT role, person_name, household_code FROM sessions WHERE token = ?", token);
    if (!row)
        return null;
    return { role: row.role, name: row.person_name, householdCode: row.household_code };
}
async function readJsonBody(req) {
    const ct = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json")
        throw errors_1.errors.unsupportedMediaType();
    const raw = await readBody(req, exports.MAX_JSON_BYTES);
    if (raw.length === 0)
        return {};
    try {
        const parsed = JSON.parse(raw.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw errors_1.errors.validation({ body: "Send a JSON object." });
        }
        return parsed;
    }
    catch (e) {
        if (e instanceof errors_1.ApiError)
            throw e;
        throw errors_1.errors.validation({ body: "Send valid JSON." });
    }
}
function readRawBody(req) {
    return readBody(req, exports.MAX_UPLOAD_BYTES);
}
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = req.headers["content-length"];
        if (declared !== undefined && parseInt(declared, 10) > limit) {
            reject(errors_1.errors.tooLarge());
            req.resume();
            return;
        }
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(errors_1.errors.tooLarge());
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", (e) => reject(new errors_1.ApiError(400, "bad_request", e.message)));
    });
}
/** Cross-origin state-changing requests are refused. */
function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    if (origin === "null")
        return false;
    try {
        const o = new URL(origin);
        const host = req.headers.host;
        return host !== undefined && o.host === host;
    }
    catch {
        return false;
    }
}
function sendJson(res, status, body, headers = {}) {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(payload.length),
        "Cache-Control": "no-store",
        ...headers,
    });
    res.end(payload);
}
function sendError(res, err) {
    sendJson(res, err.status, JSON.parse(err.body()), err.headers);
}
function etagOf(revision) {
    return `"r${revision}"`;
}
function parseIfMatch(value) {
    if (value === undefined)
        return { revision: null };
    const m = /^"?r(\d+)"?$/.exec(value.trim());
    if (!m)
        return { revision: -1 };
    return { revision: parseInt(m[1], 10) };
}
