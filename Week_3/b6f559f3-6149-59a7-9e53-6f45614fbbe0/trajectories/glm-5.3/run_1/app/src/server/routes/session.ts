// Session routes: sign in, sign out, who am I.
import { sendJson, setCookie, clearCookie } from '../http';
import { notFound, unauthenticated, ApiError } from '../errors';
import { COPY } from '../../domain/copy';
import { hashPassword, allWorkspacesOf, personBySession } from '../store';
import { randomBytes } from 'node:crypto';
import type { RouteCtx } from '../routes';

export async function handleSessionRoutes(ctx: RouteCtx): Promise<void> {
  if (ctx.path === '/api/session' && ctx.method === 'POST') {
    const body = ctx.body as { email?: string; password?: string };
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password ?? '';
    const res = await ctx.app.pool.query<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT id, name, email, password_hash FROM people WHERE lower(email) = $1`,
      [email],
    );
    const row = res.rows[0];
    if (!row || row.password_hash !== hashPassword(password)) {
      throw new ApiError(401, 'bad_credentials', COPY.badCredentials);
    }
    const token = randomBytes(24).toString('hex');
    await ctx.app.pool.query(
      `INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, now())`,
      [token, row.id],
    );
    setCookie(ctx.res, 'hs_session', token);
    sendJson(ctx.res, 200, {
      user: { id: row.id, name: row.name, email: row.email },
    });
    return;
  }
  if (ctx.path === '/api/session' && ctx.method === 'DELETE') {
    const token = ctx.cookies['hs_session'];
    if (token) {
      await ctx.app.pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    }
    clearCookie(ctx.res, 'hs_session');
    ctx.res.writeHead(204);
    ctx.res.end();
    return;
  }
  if (ctx.path === '/api/me' && ctx.method === 'GET') {
    const person = await personBySession(ctx.app.pool, ctx.cookies['hs_session']);
    if (!person) throw unauthenticated();
    const workspaces = await allWorkspacesOf(ctx.app.pool, person.id);
    sendJson(ctx.res, 200, {
      user: { id: person.id, name: person.name, email: person.email },
      workspaces,
    });
    return;
  }
  throw notFound();
}
