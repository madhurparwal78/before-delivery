import { ApiError, validationError } from '../domain/errors.js';
import { sentences } from '../domain/sentences.js';
import { accountForCredentials, createSession, deleteSession } from '../db/repo.js';
import { countFailedSignIn, guardSignIn, loadAccount } from './guards.js';
import { jsonBody, requireBodySize, route, SESSION_COOKIE, type Ctx, type Reply } from './server.js';

function cookieFor(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function registerSessionRoutes(): void {
  route('POST', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    guardSignIn(ctx);
    requireBodySize(ctx);
    const body = jsonBody(ctx);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (email === '' || password === '') {
      throw validationError({
        email: email === '' ? 'An email address is needed.' : 'A password is needed.',
      });
    }
    const account = await accountForCredentials(email, password);
    if (account === null) {
      countFailedSignIn(ctx);
      throw new ApiError(401, 'bad_credentials', sentences.badCredentials);
    }
    const token = await createSession(account.id);
    ctx.setCookie = cookieFor(token);
    return {
      status: 200,
      body: {
        role: account.role,
        email: account.email,
        displayName: account.displayName,
        accountId: account.id,
      },
    };
  });

  route('GET', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    const account = await loadAccount(ctx);
    if (account === null) throw new ApiError(401, 'unauthenticated', 'Sign in to do that.');
    return {
      status: 200,
      body: {
        role: account.role,
        email: account.email,
        displayName: account.displayName,
        accountId: account.id,
      },
    };
  });

  route('DELETE', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    const account = await loadAccount(ctx);
    if (account === null) throw new ApiError(401, 'unauthenticated', 'Sign in to do that.');
    if (ctx.sessionToken !== null) await deleteSession(ctx.sessionToken);
    ctx.setCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    return { status: 204 };
  });
}
