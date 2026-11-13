import {
  createSession,
  deleteSession,
  findUserByEmail,
  teamById,
} from '../db/accounts';
import { apiError } from '../http/errors';
import {
  clearCookie,
  cookies,
  readJsonBody,
  sendJson,
  sendNoContent,
  setCookie,
  str,
  type Ctx,
} from '../http/http';
import { verifyPassword } from '../services/passwords';
import { requireUser, SESSION_COOKIE } from './auth';

/** `next` is honoured only when it is a same-site path. */
export function safeNext(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/app';
  }
  return next;
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const email = (str(body, 'email') ?? '').trim().toLowerCase();
  const password = str(body, 'password') ?? '';
  const found = await findUserByEmail(email);
  if (found === null || !(await verifyPassword(password, found.passwordHash))) {
    throw apiError('invalid_credentials');
  }
  const sessionId = await createSession(found.user.id);
  setCookie(ctx, SESSION_COOKIE, sessionId, { maxAgeSeconds: 60 * 60 * 24 * 14 });
  sendJson(ctx, 200, {
    user: { id: found.user.id, email: found.user.email, name: found.user.name },
    redirectTo: safeNext(str(body, 'next')),
  });
}

export async function signOut(ctx: Ctx): Promise<void> {
  const sessionId = cookies(ctx)[SESSION_COOKIE];
  if (sessionId !== undefined) await deleteSession(sessionId);
  clearCookie(ctx, SESSION_COOKIE);
  sendNoContent(ctx);
}

export async function me(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const team = await teamById(user.teamId);
  sendJson(ctx, 200, {
    user: { id: user.id, email: user.email, name: user.name },
    team: team === null ? null : { id: team.id, name: team.name },
    role: user.role,
  });
}
