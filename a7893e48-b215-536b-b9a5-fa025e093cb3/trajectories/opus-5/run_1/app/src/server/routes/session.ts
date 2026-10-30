import type { Role } from '../../shared/types.js';
import { pool, queryOne } from '../db/pool.js';
import { json, noContent, type Reply } from '../http/context.js';
import { invalidCredentials } from '../http/errors.js';
import type { Route } from '../http/router.js';
import {
  SESSION_COOKIE,
  cookieValue,
  createSession,
  deleteSession,
  passwordMatches,
  publicUser,
} from '../http/session.js';
import { billingState, mailState } from '../services/health.js';
import { queuedEmailCount } from '../services/mail.js';

function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${cookieValue(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`;
}

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    handle: async (): Promise<Reply> => json(200, { status: 'ok' }),
  },
  {
    method: 'GET',
    pattern: '/api/status',
    handle: async (): Promise<Reply> =>
      json(200, {
        billing: billingState(),
        mail: mailState(),
        queued_emails: await queuedEmailCount(),
      }),
  },
  {
    method: 'POST',
    pattern: '/api/session',
    handle: async (ctx): Promise<Reply> => {
      const body = ctx.body();
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = await queryOne<{ id: string; password_hash: string }>(
        pool,
        'SELECT id, password_hash FROM users WHERE lower(email) = $1',
        [email],
      );
      if (!row || !passwordMatches(password, row.password_hash)) throw invalidCredentials();
      const sessionId = await createSession(row.id);
      const actor = await queryOne<{
        id: string;
        name: string;
        email: string;
        role: Role;
        operator_id: string;
        renter_id: string | null;
        site_id: string | null;
      }>(
        pool,
        'SELECT id, name, email, role, operator_id, renter_id, site_id FROM users WHERE id = $1',
        [row.id],
      );
      if (!actor) throw invalidCredentials();
      const siteIds =
        actor.site_id !== null
          ? [actor.site_id]
          : (
              await pool.query<{ id: string }>(
                'SELECT id FROM sites WHERE operator_id = $1 ORDER BY sort_order',
                [actor.operator_id],
              )
            ).rows.map((site) => site.id);
      return {
        status: 200,
        body: {
          user: {
            id: actor.id,
            name: actor.name,
            email: actor.email,
            role: actor.role,
            operator_id: actor.operator_id,
            site_ids: siteIds,
            renter_id: actor.renter_id,
          },
        },
        setCookie: sessionCookie(sessionId),
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      await deleteSession(actor.sessionId);
      return {
        ...noContent(),
        setCookie: `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    handle: async (ctx): Promise<Reply> => json(200, { user: publicUser(ctx.requireActor()) }),
  },
];
