import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomToken } from './passwords.js';
export function jsonResult(status, body) {
    return { status, body };
}
const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 10_100_000;
const SESSION_COOKIE = 'relayline_session';
const SESSION_TTL_MS = 12 * 3600 * 1000;
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name)
            out[name] = decodeURIComponent(value);
    }
    return out;
}
export async function createSession(db, userId) {
    const token = randomToken(32);
    await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
        token,
        userId,
        new Date(Date.now() + SESSION_TTL_MS),
    ]);
    return token;
}
export async function sessionUser(db, token) {
    if (!token)
        return null;
    const res = await db.query(`SELECT s.token, u.id, u.name, u.email, u.role, u.org_id, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]);
    if (res.rowCount === 0)
        return null;
    const row = res.rows[0];
    if (row.expires_at.getTime() < Date.now()) {
        await db.query('DELETE FROM sessions WHERE token = $1', [token]);
        return null;
    }
    return {
        user: { id: row.id, name: row.name, email: row.email, role: row.role, org_id: row.org_id },
        sessionId: row.token,
    };
}
export async function endSession(db, token) {
    if (!token)
        return;
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}
export function sessionCookieHeader(token) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}
export function clearSessionCookieHeader() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export function sessionTokenOf(cookies) {
    return cookies[SESSION_COOKIE];
}
export function isJsonRequest(req) {
    const type = req.headers['content-type'] ?? '';
    return type.toLowerCase().startsWith('application/json');
}
export function isMultipartRequest(req) {
    const type = req.headers['content-type'] ?? '';
    return type.toLowerCase().startsWith('multipart/form-data');
}
/** Read the body up to the request-specific limit. `null` means the limit was exceeded. */
export function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length'] ?? '0');
        if (declared > limit) {
            resolve(null);
            req.resume();
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                resolve(null);
                req.resume();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
export function originAllowed(req, port) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    const host = req.headers.host ?? `localhost:${port}`;
    try {
        const originUrl = new URL(origin);
        return originUrl.host === host;
    }
    catch {
        return false;
    }
}
export const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const MIME = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.html': 'text/html; charset=utf-8',
};
/** Only the built front end, its bundled fonts and /api are served; never source, config
 * files, dotfiles, lockfiles, env files or source maps. */
export function staticPathOf(pathname) {
    if (pathname === '/' || pathname === '/bookings' || pathname === '/billing' || pathname === '') {
        return path.join(distDir, 'index.html');
    }
    if (pathname.startsWith('/assets/')) {
        const rest = pathname.slice('/assets/'.length);
        if (rest.includes('..') || rest.includes('/'))
            return null;
        return path.join(distDir, 'assets', rest);
    }
    if (pathname.startsWith('/fonts/')) {
        const rest = pathname.slice('/fonts/'.length);
        if (rest.includes('..') || rest.includes('/'))
            return null;
        return path.join(distDir, 'fonts', rest);
    }
    return null;
}
export async function serveStatic(pathname) {
    const file = staticPathOf(pathname);
    if (file === null) {
        return { status: 404, body: { error: 'not_found', message: 'Nothing is served at this address.' } };
    }
    try {
        const bytes = await readFile(file);
        const ext = path.extname(file);
        return {
            status: 200,
            body: bytes,
            headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
        };
    }
    catch {
        return { status: 404, body: { error: 'not_found', message: 'Nothing is served at this address.' } };
    }
}
export function errorBody(err) {
    return err.body();
}
