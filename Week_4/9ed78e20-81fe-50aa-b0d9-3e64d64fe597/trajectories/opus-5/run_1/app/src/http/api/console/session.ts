import { pool, query } from '../../../db/pool.js';
import { normaliseEmail } from '../../../domain/candidate.js';
import { activeGrants } from '../../../domain/roles.js';
import { lockState, recordFailure, recordSuccess } from '../../../domain/signin.js';
import { errors } from '../../errors.js';
import { jsonReply, noContentReply } from '../../reply.js';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  loadSession,
  sessionCookie,
  verifyPassword,
} from '../../session.js';
import { route } from '../../server.js';
import { consoleWrite } from './guard.js';

export function registerConsoleSessionApi(): void {
  route('POST', '/api/console/session', 'signin', async (ctx) => {
    const payload = ctx.json() as { email?: unknown; password?: unknown };
    const email = typeof payload.email === 'string' ? normaliseEmail(payload.email) : '';
    const password = typeof payload.password === 'string' ? payload.password : '';

    const lock = await lockState(email);
    if (lock.locked) throw errors.signinLocked(lock.retryAfter);

    const result = await query<{ email: string; name: string; password_hash: string }>(
      'SELECT email, name, password_hash FROM staff WHERE email = $1',
      [email],
    );
    const staff = result.rows[0];
    if (staff === undefined || !verifyPassword(password, staff.password_hash)) {
      await recordFailure(email);
      throw errors.invalidCredentials();
    }
    await recordSuccess(email);
    const id = await createSession(staff.email);
    const grants = await activeGrants(pool, staff.email);
    return jsonReply(
      200,
      {
        staff: {
          email: staff.email,
          name: staff.name,
          roles: grants.map((grant) => ({
            role: grant.role,
            expires_at: grant.expires_at.toISOString(),
          })),
        },
      },
      { 'Set-Cookie': sessionCookie(id) },
    );
  });

  route('DELETE', '/api/console/session', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async () => {
      await destroySession(ctx.headers);
      return noContentReply({ 'Set-Cookie': clearedSessionCookie() });
    }),
  );

  route('GET', '/api/console/me', null, async (ctx) => {
    const staff = await loadSession(pool, ctx.headers);
    if (staff === null) throw errors.unauthenticated();
    const grants = await activeGrants(pool, staff.email);
    return jsonReply(200, {
      email: staff.email,
      name: staff.name,
      roles: grants.map((grant) => ({
        role: grant.role,
        expires_at: grant.expires_at.toISOString(),
      })),
    });
  });
}
