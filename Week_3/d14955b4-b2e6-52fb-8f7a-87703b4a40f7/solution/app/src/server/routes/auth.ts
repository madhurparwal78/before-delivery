import { authenticateStaff, clearedCookies, login, logout, refresh, requireChange, sessionBody } from '../auth.js';
import { HttpError, changeRefused, route, sameOrigin, validation } from '../http.js';

export const authRoutes = [
  route('POST', '/api/auth/login', async (ctx) => {
    if (!sameOrigin(ctx.req)) throw changeRefused();
    const body = await ctx.json();
    const fields: Record<string, string> = {};
    if (typeof body.email !== 'string' || body.email.trim() === '') fields.email = 'Enter your email.';
    if (typeof body.password !== 'string' || body.password === '') fields.password = 'Enter your password.';
    if (Object.keys(fields).length > 0) throw validation(fields);
    const session = (body.email as string).includes('\u0000') ? null : await login(body.email as string, body.password as string);
    if (!session) throw new HttpError(401, 'invalid_credentials', "That email and password don't match.");
    return { status: 200, body: sessionBody(session.staff), headers: { 'Set-Cookie': session.cookies } };
  }),

  route('GET', '/api/auth/session', async (ctx) => ({ status: 200, body: sessionBody(await authenticateStaff(ctx)) })),

  route('POST', '/api/auth/refresh', async (ctx) => {
    const session = await refresh(ctx);
    return { status: 200, body: sessionBody(session.staff), headers: { 'Set-Cookie': session.cookies } };
  }),

  route('POST', '/api/auth/logout', async (ctx) => {
    const staff = await authenticateStaff(ctx);
    requireChange(ctx, staff);
    await logout(ctx, staff);
    return { status: 204, headers: { 'Set-Cookie': clearedCookies() } };
  }),
];
