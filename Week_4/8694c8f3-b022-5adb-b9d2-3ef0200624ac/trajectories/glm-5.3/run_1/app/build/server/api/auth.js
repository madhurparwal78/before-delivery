import { errors, AUTH_FIELD_MESSAGES } from '../errors.js';
import { hashPassword, newId, newSessionId, verifyPassword } from '../crypto.js';
import { validateEmail, validateDisplayName, validatePassword } from '../layers.js';
import { requireUser, SESSION_COOKIE } from '../access.js';
import { jsonOk, readBody } from './api.js';
const SESSION_MS = 30 * 86_400_000;
function setSessionCookie(ctx, sessionId) {
    const expires = new Date(Date.now() + SESSION_MS).toUTCString();
    ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
}
function clearSessionCookie(ctx) {
    ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
export function sessionCookieValue(ctx) {
    const header = ctx.req.headers.cookie;
    if (header === undefined)
        return undefined;
    for (const part of header.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === SESSION_COOKIE)
            return rest.join('=');
    }
    return undefined;
}
export async function signup(deps, ctx) {
    const body = await readBody(ctx, 1_000_000);
    const fields = {};
    const email = validateEmail(body.email);
    if (email instanceof Error)
        fields.email = email.message;
    const password = validatePassword(body.password);
    if (password instanceof Error)
        fields.password = password.message;
    const displayName = validateDisplayName(body.display_name);
    if (displayName instanceof Error)
        fields.display_name = displayName.message;
    if (Object.keys(fields).length > 0)
        throw errors.validation(fields);
    // The validators return the trimmed, lowercase values; store those.
    const emailText = email;
    const passwordText = password;
    const nameText = displayName;
    const existing = await deps.pool.query('SELECT id FROM users WHERE email = $1', [emailText]);
    if ((existing.rowCount ?? 0) > 0)
        throw errors.emailTaken();
    const id = newId();
    await deps.pool.query('INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4)', [id, emailText, hashPassword(passwordText), nameText]);
    const sessionId = newSessionId();
    await deps.pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)', [sessionId, id, new Date(Date.now() + SESSION_MS)]);
    setSessionCookie(ctx, sessionId);
    jsonOk(ctx, 201, { user: { id, email: emailText, display_name: nameText } });
}
export async function login(deps, ctx) {
    const body = await readBody(ctx, 1_000_000);
    const fields = {};
    if (typeof body.email !== 'string' || body.email.trim() === '')
        fields.email = AUTH_FIELD_MESSAGES.emailInvalid;
    if (typeof body.password !== 'string' || body.password.length < 10)
        fields.password = AUTH_FIELD_MESSAGES.passwordShort;
    if (Object.keys(fields).length > 0)
        throw errors.validation(fields);
    const email = String(body.email).trim().toLowerCase();
    const result = await deps.pool.query('SELECT id, password_hash, display_name FROM users WHERE email = $1', [email]);
    const row = result.rows[0];
    if (row === undefined || !(await verifyPassword(String(body.password), row.password_hash))) {
        throw errors.invalidCredentials();
    }
    const sessionId = newSessionId();
    await deps.pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)', [sessionId, row.id, new Date(Date.now() + SESSION_MS)]);
    setSessionCookie(ctx, sessionId);
    jsonOk(ctx, 200, { user: { id: row.id, email, display_name: row.display_name } });
}
export async function logout(deps, ctx) {
    const sessionId = sessionCookieValue(ctx);
    if (sessionId !== undefined) {
        await deps.pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    }
    clearSessionCookie(ctx);
    ctx.res.writeHead(204);
    ctx.res.end();
}
export async function me(deps, ctx) {
    const user = await requireUser(deps, sessionCookieValue(ctx));
    jsonOk(ctx, 200, { user });
}
export const authRoutes = (deps) => ([
    { method: 'POST', path: '/api/auth/signup', handler: (ctx) => signup(deps, ctx) },
    { method: 'POST', path: '/api/auth/login', handler: (ctx) => login(deps, ctx) },
    { method: 'POST', path: '/api/auth/logout', handler: (ctx) => logout(deps, ctx) },
    { method: 'GET', path: '/api/me', handler: (ctx) => me(deps, ctx) },
]);
