import { MESSAGES } from '../../shared/messages';
import type { MeResponse } from '../../shared/protocol';
import { query } from '../db';
import { clearedSessionCookie, cookieToken, fail, invalid, json, noContent, router, sessionCookie } from '../http';
import { verifyPassword } from '../passwords';
import { createSession } from '../sessions';

router.post('/api/session', async (ctx) => {
  const { email, password } = await ctx.jsonObject();
  if (typeof email !== 'string') invalid('email', MESSAGES.invalidValue);
  if (typeof password !== 'string') invalid('password', MESSAGES.invalidValue);
  const rows = await query<{ id: string; name: string; email: string; password_hash: string }>(
    'SELECT id, name, email, password_hash FROM people WHERE lower(email) = lower($1)',
    [email],
  );
  const person = rows[0];
  const verified = person ? await verifyPassword(password, person.password_hash) : false;
  if (!person || !verified) return fail(401, 'bad_credentials', MESSAGES.badCredentials);
  const token = await createSession(person.id);
  return json(200, { user: { id: person.id, name: person.name, email: person.email } }, { 'Set-Cookie': sessionCookie(token) });
});

router.delete('/api/session', async (ctx) => {
  const token = cookieToken(ctx.header('cookie'));
  if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
  return { ...noContent(), headers: { 'Set-Cookie': clearedSessionCookie() } };
});

router.get('/api/me', async (ctx) => {
  const person = await ctx.requirePerson();
  const workspaces = await query<{ id: string; name: string; role: 'Owner' | 'Member' }>(
    `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.person_id = $1 ORDER BY w.name`,
    [person.id],
  );
  const body: MeResponse = { user: { id: person.id, name: person.name, email: person.email }, workspaces };
  return json(200, body);
});
