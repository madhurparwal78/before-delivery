import { jsonReply, noContent, type Reply } from '../http/context.js';
import { invalidCredentials } from '../http/errors.js';
import type { Router } from '../http/router.js';
import {
  clearedSessionCookie,
  endSession,
  memberByEmail,
  passwordMatches,
  sessionCookie,
  startSession,
  toMember,
} from '../http/session.js';

export function registerSessionRoutes(router: Router): void {
  router.post('/api/session', async (context): Promise<Reply> => {
    const body = await context.json();
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = await memberByEmail(email);
    if (!row || row.status !== 'active' || !(await passwordMatches(password, row.password_hash))) {
      throw invalidCredentials();
    }
    const member = toMember(row);
    context.setCookies.push(sessionCookie(await startSession(member.id)));
    return jsonReply(200, {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        organisation: member.organisation,
      },
    });
  });

  router.get('/api/session', async (context): Promise<Reply> => {
    const member = await context.member();
    return jsonReply(200, {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        organisation: member.organisation,
        approvalLimits: member.approvalLimits,
      },
    });
  });

  router.delete('/api/session', async (context): Promise<Reply> => {
    const token = context.sessionToken;
    if (token) await endSession(token);
    context.setCookies.push(clearedSessionCookie());
    return noContent();
  });
}
