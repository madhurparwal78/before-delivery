import { ApiError, MESSAGES } from '../../shared/errors.js';
import { clearedSessionCookie, cookies, readJson, requireString, route, sendEmpty, sendJson, sessionCookie } from '../http.js';
import { checkLoginRate, createUser, endSession, signIn, startSession, userExists, validateCredentials } from '../sessions.js';

export function registerAuthRoutes(): void {
  route('POST', '/api/auth/register', async (context) => {
    const body = await readJson(context);
    const username = requireString(body, 'username').toLowerCase();
    const password = requireString(body, 'password');
    if (await userExists(username)) throw new ApiError('username_taken', MESSAGES.usernameTaken);
    validateCredentials(username, password);
    await createUser(username, password);
    const token = await startSession(username);
    sendJson(context.res, 201, { username }, { 'set-cookie': sessionCookie(token) });
  });

  route('POST', '/api/auth/login', async (context) => {
    const body = await readJson(context);
    const username = requireString(body, 'username').toLowerCase();
    const password = requireString(body, 'password');
    await checkLoginRate(username);
    const token = await signIn(username, password);
    sendJson(context.res, 200, { username }, { 'set-cookie': sessionCookie(token) });
  });

  route('POST', '/api/auth/logout', async (context) => {
    const token = cookies(context.req).plot_session;
    if (token) await endSession(token);
    sendEmpty(context.res, 204, { 'set-cookie': clearedSessionCookie() });
  });

  route('GET', '/api/me', async (context) => {
    if (!context.username) throw new ApiError('unauthenticated', MESSAGES.unauthenticated);
    sendJson(context.res, 200, { username: context.username });
  });
}
