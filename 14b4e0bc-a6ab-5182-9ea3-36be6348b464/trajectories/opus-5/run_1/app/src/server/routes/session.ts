import type { Role } from '../../shared/domain.ts';
import {
  clearedSessionCookie,
  hashToken,
  newSessionToken,
  sessionCookie,
  verifyPassword,
} from '../auth.ts';
import { announceSessionEnded } from '../commit.ts';
import { query, withTransaction } from '../db.ts';
import { bus } from '../events.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { currentStatus } from '../services/status.ts';

interface SessionUserBody {
  user: { id: string; name: string; email: string; role: Role };
}

function userBody(row: { id: string; name: string; email: string; role: Role }): SessionUserBody {
  return { user: { id: row.id, name: row.name, email: row.email, role: row.role } };
}

export function registerSessionRoutes(router: Router): void {
  router.add('GET', '/api/health', async () => ({ status: 200, json: { status: 'ok' } }));

  router.add('POST', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    const body = ctx.json();
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const found = await query<{
      id: string;
      name: string;
      email: string;
      role: Role;
      password_hash: string;
    }>('SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)', [email]);
    const row = found.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) throw errors.invalidCredentials();

    const { token, tokenHash } = newSessionToken();
    const carried = ctx.sessionToken();
    await withTransaction(async (client) => {
      if (carried !== null) {
        const previous = hashToken(carried);
        await client.query('DELETE FROM sessions WHERE token_hash = $1', [previous]);
        await announceSessionEnded(client, [previous]);
      }
      await client.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1,$2)', [tokenHash, row.id]);
    });
    if (carried !== null) bus.publishSessionEnded(hashToken(carried));
    return { status: 200, json: userBody(row), cookie: sessionCookie(token) };
  });

  router.add('GET', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    return {
      status: 200,
      json: userBody({ id: actor.userId, name: actor.name, email: actor.email, role: actor.role }),
    };
  });

  router.add('DELETE', '/api/session', async (ctx: Ctx): Promise<Reply> => {
    const actor = await ctx.requireActor();
    await withTransaction(async (client) => {
      await client.query('DELETE FROM sessions WHERE token_hash = $1', [actor.tokenHash]);
      await announceSessionEnded(client, [actor.tokenHash]);
    });
    bus.publishSessionEnded(actor.tokenHash);
    return { status: 204, cookie: clearedSessionCookie() };
  });

  router.add('GET', '/api/status', async (ctx: Ctx): Promise<Reply> => {
    await ctx.requireActor();
    return { status: 200, json: await currentStatus() };
  });
}
