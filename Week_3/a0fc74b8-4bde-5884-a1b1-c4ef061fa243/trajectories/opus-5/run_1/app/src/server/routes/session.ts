import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  requireCaller,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import { queryOne } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { readString } from '../http/read.ts';
import { sendEmpty, sendJson, type HttpApp } from '../http/server.ts';
import type { SessionJson } from '../../shared/types.ts';

type LoginRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  team_id: string;
  team_name: string;
};

const isRole = (value: string): value is SessionJson['role'] =>
  value === 'owner' || value === 'member' || value === 'viewer';

export const registerSessionRoutes = (app: HttpApp): void => {
  app.on('POST', '/api/session', async (ctx) => {
    const body = await ctx.body();
    const email = (readString(body, 'email') ?? '').trim().toLowerCase();
    const password = readString(body, 'password') ?? '';
    const row = await queryOne<LoginRow>(
      `SELECT u.id, u.email, u.name, u.password_hash, u.role, t.id AS team_id, t.name AS team_name
       FROM users u JOIN teams t ON t.id = u.team_id WHERE u.email = $1`,
      [email],
    );
    if (!row || !verifyPassword(password, row.password_hash) || !isRole(row.role)) {
      throw new ApiError(401, { error: 'invalid_credentials' });
    }
    const sessionId = await createSession(row.id);
    setSessionCookie(ctx.res, sessionId);
    const payload: SessionJson = {
      user: { id: row.id, email: row.email, name: row.name },
      team: { id: row.team_id, name: row.team_name },
      role: row.role,
    };
    sendJson(ctx.res, 200, payload);
  });

  app.on('GET', '/api/session', async (ctx) => {
    const caller = await requireCaller(ctx);
    const payload: SessionJson = {
      user: { id: caller.userId, email: caller.email, name: caller.name },
      team: { id: caller.teamId, name: caller.teamName },
      role: caller.role,
    };
    sendJson(ctx.res, 200, payload);
  });

  app.on('DELETE', '/api/session', async (ctx) => {
    const sessionId = ctx.cookies[SESSION_COOKIE];
    if (sessionId) await destroySession(sessionId);
    clearSessionCookie(ctx.res);
    sendEmpty(ctx.res, 204);
  });
};
