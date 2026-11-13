import crypto from 'node:crypto';
import { config } from '../config';
import { transaction } from '../db';
import { ApiError, fail, ValidationError } from '../errors';
import { copy } from '../../shared/copy';
import { formatIsoDate } from '../../shared/format';
import { workspaceNow } from '../clock';
import {
  assertNotLocked,
  callerFromSession,
  clearSigninFailures,
  createSession,
  createVerifyToken,
  dropSession,
  findUserByEmail,
  findVerifyToken,
  findWorkspace,
  hashPassword,
  markVerified,
  newerTokenExists,
  nextQuoteNumber,
  passwordMatches,
  recordSigninFailure,
  requireCaller,
  signinLockSeconds,
  validateSignup,
  verifyLinkExpired,
} from '../accounts';
import { query } from '../db';
import { sendConfirmationEmail, sendQuoteEmail } from '../emails';
import { MailUnavailable } from '../mail';
import { createWorkspace } from '../workspaces';
import { json, noContent, type Router } from '../http';

function sessionCookie(token: string): string {
  const maxAge = config.sessionDays * 86_400;
  return `${config.sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearedCookie(): string {
  return `${config.sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function registerAccountRoutes(router: Router): void {
  router.add('POST', '/api/auth/signup', async (context) => {
    const body = await context.json();
    const { name, email, password, timeZone } = validateSignup(body);
    if ((await findUserByEmail(email)) !== null) {
      throw new ValidationError({ email: copy.account.emailTaken });
    }
    const now = new Date();
    const passwordHash = await hashPassword(password);
    const user = await transaction(async (client) => {
      const seed = await createWorkspace(client, timeZone, 'mm', now, formatIsoDate(now, timeZone));
      const rows = await client.query<{ id: string }>(
        `insert into users (id, workspace_id, name, email, password_hash, verified, created_at)
         values ($1,$2,$3,$4,$5,false,$6) returning id`,
        [crypto.randomUUID(), seed.workspace.id, name, email, passwordHash, now],
      );
      const id = rows.rows[0]!.id;
      await client.query('update drawings set owner_user_id = $2 where workspace_id = $1 and is_sample = false', [
        seed.workspace.id,
        id,
      ]);
      return { id, name, email };
    });

    const token = await createVerifyToken(user.id, now);
    let emailStatus: 'sent' | 'not_sent' = 'sent';
    try {
      await sendConfirmationEmail(email, name, token);
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      emailStatus = 'not_sent';
    }
    return json(201, {
      user: { id: user.id, name, email, verified: false },
      email_status: emailStatus,
    });
  });

  router.add('POST', '/api/auth/verify', async (context) => {
    const body = await context.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const record = await findVerifyToken(token);
    if (record === null) fail('not_found');
    const user = await query<{ id: string; email: string; verified: boolean; workspace_id: string }>(
      'select id, email, verified, workspace_id from users where id = $1',
      [record.user_id],
    );
    const owner = user[0];
    if (owner === undefined) fail('not_found');
    const workspace = await findWorkspace(owner.workspace_id);
    if (workspace === null) fail('not_found');
    const now = workspaceNow(workspace);
    if (owner.verified) return json(200, { verified: true, email: owner.email });
    if (await newerTokenExists(record)) {
      throw new ApiError('verify_link_replaced', { email: owner.email });
    }
    if (verifyLinkExpired(record, now)) {
      throw new ApiError('verify_link_expired', { email: owner.email });
    }
    await markVerified(owner.id, workspace);
    return json(200, { verified: true, email: owner.email });
  });

  router.add('POST', '/api/auth/verify/resend', async (context) => {
    const body = await context.json();
    let email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email === '' && typeof body.token === 'string') {
      const record = await findVerifyToken(body.token);
      if (record !== null) {
        const rows = await query<{ email: string }>('select email from users where id = $1', [record.user_id]);
        email = rows[0]?.email ?? '';
      }
    }
    const user = email === '' ? null : await findUserByEmail(email);
    if (user === null) return json(202, { email_status: 'sent' });
    const workspace = await findWorkspace(user.workspace_id);
    if (workspace === null) fail('not_found');
    const token = await createVerifyToken(user.id, workspaceNow(workspace));
    try {
      await sendConfirmationEmail(user.email, user.name, token);
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      fail('mail_unavailable');
    }
    return json(202, { email_status: 'sent' });
  });

  router.add('POST', '/api/auth/signin', async (context) => {
    const body = await context.json();
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await findUserByEmail(email);
    const workspace = user === null ? null : await findWorkspace(user.workspace_id);
    const now = workspace === null ? new Date() : workspaceNow(workspace);

    assertNotLocked(await signinLockSeconds(email, now));

    if (user === null || !(await passwordMatches(password, user.password_hash))) {
      assertNotLocked(await recordSigninFailure(email, now));
      fail('invalid_credentials');
    }
    await clearSigninFailures(email);
    if (!user.verified) throw new ApiError('unverified', { email: user.email });
    const token = await createSession(user.id, now);
    return json(
      200,
      { user: { id: user.id, name: user.name, email: user.email, verified: true } },
      { 'set-cookie': sessionCookie(token) },
    );
  });

  router.add('POST', '/api/auth/signout', async (context) => {
    const token = context.cookie(config.sessionCookie);
    if (token !== undefined) await dropSession(token);
    return noContent({ 'set-cookie': clearedCookie() });
  });

  router.add('GET', '/api/me', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    return json(200, {
      user: {
        id: caller.user.id,
        name: caller.user.name,
        email: caller.user.email,
        time_zone: caller.workspace.time_zone,
        verified: caller.user.verified,
      },
      trial: caller.trial,
      now: caller.now.toISOString(),
    });
  });

  router.add('POST', '/api/quotes', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    const { number, seq, date } = await nextQuoteNumber(caller.workspace, caller.now);
    try {
      await sendQuoteEmail({ to: caller.user.email, quoteNumber: number, issueDate: date });
    } catch (error) {
      if (!(error instanceof MailUnavailable)) throw error;
      fail('mail_unavailable');
    }
    await query(
      `insert into quotes (id, workspace_id, number, issue_date, seq, sent_to, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), caller.workspace.id, number, date, seq, caller.user.email, caller.now],
    );
    return json(201, {
      quote: { number, amount: '12.00', currency: 'USD', sent_to: caller.user.email },
    });
  });
}
