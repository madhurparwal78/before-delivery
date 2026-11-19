// Request and response plumbing: body limits, content types, origins, sessions, JSON.
import { badOrigin, tooLarge, unsupportedMediaType } from "./errors.js";
const MAX_BODY_BYTES = 100_000;
export function readCookie(req, name) {
    const header = req.headers.cookie;
    if (header === undefined)
        return null;
    for (const part of header.split(';')) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq > 0 && trimmed.slice(0, eq) === name)
            return decodeURIComponent(trimmed.slice(eq + 1));
    }
    return null;
}
export function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `sw_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}
export function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', 'sw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
export function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
}
export function sendError(res, error) {
    sendJson(res, error.status, error.body);
}
/** The published precedence, applied to every request before any route runs. */
export async function checkPrecedence(req, config) {
    const contentLength = Number.parseInt(String(req.headers['content-length'] ?? '0'), 10);
    if (contentLength > MAX_BODY_BYTES)
        return tooLarge();
    const isWrite = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
    const contentType = req.headers['content-type'] ?? '';
    if (isWrite && contentType !== '' && !contentType.toLowerCase().startsWith('application/json'))
        return unsupportedMediaType();
    if (isWrite && contentType === '' && contentLength > 0)
        return unsupportedMediaType();
    const origin = req.headers.origin;
    if (origin !== undefined && isWrite) {
        const allowed = new Set();
        try {
            allowed.add(new URL(config.publicUrl).origin);
            const host = req.headers.host;
            if (host !== undefined) {
                allowed.add(`http://${host}`);
                allowed.add(`https://${host}`);
            }
        }
        catch {
            // publicUrl not parseable: fall through to host check
        }
        if (!allowed.has(origin))
            return badOrigin();
    }
    if (!isWrite)
        return { body: undefined, hasBody: false };
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            return tooLarge();
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '')
        return { body: {}, hasBody: false };
    try {
        return { body: JSON.parse(text), hasBody: true };
    }
    catch {
        return unsupportedMediaType();
    }
}
