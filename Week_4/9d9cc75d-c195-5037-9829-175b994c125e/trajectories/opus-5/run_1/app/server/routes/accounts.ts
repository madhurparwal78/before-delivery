import {
  clearedCookie,
  cookieFor,
  createSession,
  createUser,
  projectsFor,
  userByName,
  USERNAME_RE,
  verifyPassword,
} from '../auth.js';
import { config } from '../config.js';
import { asObject, fail, rateLimit, requireUser, sendJson, str, type Router } from '../http.js';

export function registerAccounts(router: Router): void {
  router.post('/api/auth/register', async (ctx) => {
    const body = asObject(await ctx.body());
    const username = (str(body.username) ?? '').toLowerCase();
    const password = str(body.password) ?? '';
    const errors: Record<string, string> = {};
    if (!USERNAME_RE.test(username)) errors.username = 'Username must be 3 to 24 letters, digits or _.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (Object.keys(errors).length > 0) fail(422, 'invalid', errors);
    if ((await userByName(username)) !== null) {
      fail(409, 'username_taken', { username: 'That username is taken.' });
    }
    const user = await createUser(username, password);
    const session = await createSession(user.id);
    ctx.setCookie(cookieFor(session));
    sendJson(ctx.res, 201, { user: { id: user.id, username: user.username } });
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = asObject(await ctx.body());
    const username = (str(body.username) ?? '').toLowerCase();
    const password = str(body.password) ?? '';
    rateLimit(`login:${username}`, config.loginRate);
    const record = await userByName(username);
    if (record === null || !verifyPassword(password, record.password_hash)) {
      fail(401, 'invalid_credentials');
    }
    const session = await createSession(record.id);
    ctx.setCookie(cookieFor(session));
    sendJson(ctx.res, 200, { user: { id: record.id, username: record.username } });
  });

  router.post('/api/auth/logout', (ctx) => {
    ctx.setCookie(clearedCookie());
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  router.get('/api/me', async (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx.res, 200, {
      user: { id: user.id, username: user.username },
      projects: await projectsFor(user.id),
    });
  });
}
