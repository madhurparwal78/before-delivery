import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { ApiError } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import { ROLE_VALUES, type Role } from '../domain/markets.js';
import { isEmail, requiredString, Validator, graphemeLimit } from './validate.js';
import { requireStaff, requireRole } from './auth.js';
import { setSessionCookie } from './app.js';
import { id, token } from './startup.js';
import { toInstantString } from '../domain/dates.js';

export interface MemberOut {
  id: string; name: string; email: string; role: string; stockistId: string | null; createdAt: string;
}

export function memberOut(m: { id: string; name: string; email: string; role: string; stockist_id: string | null; created_at: Date | string }): MemberOut {
  return {
    id: m.id, name: m.name, email: m.email, role: m.role, stockistId: m.stockist_id,
    createdAt: toInstantString(new Date(m.created_at))
  };
}

export async function queueMail(state: { db: import('./db.js').Db }, workspaceId: string, kind: string, payload: Record<string, unknown>, runAt?: Date): Promise<void> {
  await state.db.query(
    'INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES ($1, $2, $3, $4)',
    [runAt ?? new Date(), kind, JSON.stringify(payload), workspaceId]
  );
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/sign-in', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const v = new Validator();
    if (!email) v.add('email', MESSAGES.required);
    if (!password) v.add('password', MESSAGES.required);
    v.throwIfAny();
    const res = await state.db.query('SELECT * FROM members WHERE lower(email) = $1', [email]);
    const row = res.rows[0];
    const ok = row ? await bcrypt.compare(password, row.password_hash ?? '') : false;
    if (!row || !ok) {
      // The same answer for every address: identical bytes for known and unknown.
      throw new ApiError('invalid_credentials');
    }
    const sid = token(48);
    const expiresAt = new Date(Date.now() + state.cfg.sessionTtlSeconds * 1000);
    await state.db.query('INSERT INTO sessions (token, member_id, workspace_id, expires_at) VALUES ($1,$2,$3,$4)', [sid, row.id, row.workspace_id, expiresAt]);
    setSessionCookie(reply, sid, state.cfg.sessionTtlSeconds);
    reply.code(200).send({ member: memberOut(row) });
  });

  app.post('/api/auth/sign-out', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const cookieHeader = req.headers.cookie ?? '';
    const m = /hourline_session=([^;]+)/.exec(cookieHeader);
    if (m) await state.db.query('DELETE FROM sessions WHERE token = $1', [decodeURIComponent(m[1])]);
    reply.code(204).send();
  });

  app.get('/api/auth/session', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) {
      if (req.sessionEnded) throw new ApiError('session_ended');
      throw new ApiError('unauthenticated');
    }
    reply.code(200).send({ member: memberOut(req.session.member), workspace: req.session.workspace });
  });

  app.post('/api/auth/password-reset', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const v = new Validator();
    if (!email) v.add('email', MESSAGES.required);
    else if (!isEmail(email)) v.add('email', MESSAGES.email);
    v.throwIfAny();
    const res = await state.db.query('SELECT * FROM members WHERE lower(email) = $1', [email]);
    const row = res.rows[0];
    // An address that cannot use it records nothing and sends nothing, but the
    // answer is the same either way.
    if (row) {
      const t = token(48);
      const expiresAt = new Date(Date.now() + state.cfg.resetLinkTtlSeconds * 1000);
      await state.db.query('INSERT INTO password_resets (token, member_id, issued_at) VALUES ($1,$2,$3)', [t, row.id, new Date()]);
      const link = `${state.cfg.appPublicUrl}/reset-password/${t}`;
      await queueMail(state, row.workspace_id, 'mail', {
        kind: 'password_reset', to: row.email, subject: 'Reset your Hourline password',
        body: `Reset your password with this link (valid for ${state.cfg.resetLinkTtlSeconds} seconds):\n\n${link}\n\nIf you did not ask for this, ignore this email.`
      });
    }
    reply.code(202).send({ status: 'reset_requested' });
  });

  app.post('/api/auth/password-reset/complete', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const t = typeof body?.token === 'string' ? body.token : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const v = new Validator();
    if (!password) v.add('password', MESSAGES.required);
    else if (password.length < 12 || password.length > 128) v.add('password', MESSAGES.password);
    v.throwIfAny();
    const res = await state.db.query('SELECT * FROM password_resets WHERE token = $1', [t]);
    const row = res.rows[0];
    if (!row) throw new ApiError('not_found');
    if (row.used_at) throw new ApiError('link_used');
    if (new Date(row.issued_at).getTime() + state.cfg.resetLinkTtlSeconds * 1000 <= Date.now()) throw new ApiError('link_expired');
    const hash = await bcrypt.hash(password, 10);
    await state.db.query('UPDATE members SET password_hash = $1 WHERE id = $2', [hash, row.member_id]);
    await state.db.query('UPDATE password_resets SET used_at = now() WHERE token = $1', [t]);
    const member = await state.db.query('SELECT * FROM members WHERE id = $1', [row.member_id]);
    const sid = token(48);
    await state.db.query('INSERT INTO sessions (token, member_id, workspace_id, expires_at) VALUES ($1,$2,$3,$4)',
      [sid, row.member_id, row.workspace_id, new Date(Date.now() + state.cfg.sessionTtlSeconds * 1000)]);
    setSessionCookie(reply, sid, state.cfg.sessionTtlSeconds);
    reply.code(200).send({ member: memberOut(member.rows[0]) });
  });

  app.post('/api/auth/invitations/accept', async (req: FastifyRequest, reply: FastifyReply) => {
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const t = typeof body?.token === 'string' ? body.token : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const v = new Validator();
    if (!name) v.add('name', MESSAGES.required);
    else if (!graphemeLimit(name, 120)) v.add('name', MESSAGES.tooLong(120));
    if (!password) v.add('password', MESSAGES.required);
    else if (password.length < 12 || password.length > 128) v.add('password', MESSAGES.password);
    v.throwIfAny();
    const res = await state.db.query('SELECT * FROM invitations WHERE token = $1', [t]);
    const row = res.rows[0];
    if (!row) throw new ApiError('not_found');
    if (row.accepted_at) throw new ApiError('link_used');
    if (new Date(row.issued_at).getTime() + state.cfg.inviteLinkTtlSeconds * 1000 <= Date.now()) throw new ApiError('link_expired');
    const existing = await state.db.query('SELECT id FROM members WHERE workspace_id = $1 AND lower(email) = lower($2)', [row.workspace_id, row.email]);
    if (existing.rowCount && existing.rowCount > 0) throw new ApiError('link_used');
    const mid = id('mem');
    const hash = await bcrypt.hash(password, 10);
    await state.db.query(
      'INSERT INTO members (id, workspace_id, name, email, password_hash, role, stockist_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [mid, row.workspace_id, name, row.email, hash, row.role, row.stockist_id]
    );
    await state.db.query('UPDATE invitations SET accepted_at = now() WHERE token = $1', [t]);
    const member = await state.db.query('SELECT * FROM members WHERE id = $1', [mid]);
    const sid = token(48);
    await state.db.query('INSERT INTO sessions (token, member_id, workspace_id, expires_at) VALUES ($1,$2,$3,$4)',
      [sid, mid, row.workspace_id, new Date(Date.now() + state.cfg.sessionTtlSeconds * 1000)]);
    setSessionCookie(reply, sid, state.cfg.sessionTtlSeconds);
    reply.code(201).send({ member: memberOut(member.rows[0]) });
  });

  // Members: any staff role may read; only the launch producer may write.
  app.get('/api/members', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    if (auth.member.role === 'stockist_buyer') {
      reply.code(200).send({ items: [memberOut(auth.member)] });
      return;
    }
    const res = await state.db.query('SELECT * FROM members WHERE workspace_id = $1 ORDER BY created_at', [auth.workspaceId]);
    reply.code(200).send({ items: res.rows.map(memberOut) });
  });

  app.get('/api/members/:memberId', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireStaff(req);
    const state = req.appState;
    const { memberId } = req.params as { memberId: string };
    if (auth.member.role === 'stockist_buyer' && memberId !== auth.member.id) throw new ApiError('not_found');
    const res = await state.db.query('SELECT * FROM members WHERE id = $1 AND workspace_id = $2', [memberId, auth.workspaceId]);
    if (!res.rows[0]) throw new ApiError('not_found');
    reply.code(200).send(memberOut(res.rows[0]));
  });

  app.post('/api/members/invitations', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = typeof body?.role === 'string' ? body.role : '';
    const stockistId = body?.stockistId === undefined || body?.stockistId === null ? null : String(body.stockistId);
    const v = new Validator();
    if (!email) v.add('email', MESSAGES.required);
    else if (!isEmail(email)) v.add('email', MESSAGES.email);
    if (!ROLE_VALUES.includes(role as Role)) v.add('role', 'Choose a role.');
    if (role === 'stockist_buyer') {
      if (!stockistId) v.add('stockistId', MESSAGES.unknownStockist);
    } else if (stockistId !== null) v.add('stockistId', 'Only a stockist buyer has a store.');
    v.throwIfAny();
    if (role === 'stockist_buyer') {
      const st = await state.db.query('SELECT id FROM stockists WHERE id = $1 AND workspace_id = $2 AND status = $3', [stockistId, auth.workspaceId, 'active']);
      if (!st.rows[0]) v.add('stockistId', MESSAGES.unknownStockist);
      v.throwIfAny();
    }
    const t = token(48);
    await state.db.query(
      'INSERT INTO invitations (token, workspace_id, email, role, stockist_id) VALUES ($1,$2,$3,$4,$5)',
      [t, auth.workspaceId, email, role, stockistId]
    );
    const link = `${state.cfg.appPublicUrl}/invite/${t}`;
    const ws = await state.db.query('SELECT name FROM workspaces WHERE id = $1', [auth.workspaceId]);
    await queueMail(state, auth.workspaceId, 'mail', {
      kind: 'invitation', to: email, subject: `You're invited to ${ws.rows[0].name} on Hourline`,
      body: `You have been invited to join ${ws.rows[0].name} on Hourline as a ${role.replace('_', ' ')}.\n\nSet your password and join here (valid for ${state.cfg.inviteLinkTtlSeconds} seconds):\n\n${link}`
    });
    // The same bytes whether or not the address is already a member.
    reply.code(202).send(Buffer.from('{"status":"invitation_sent"}'));
  });

  app.patch('/api/members/:memberId', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { memberId } = req.params as { memberId: string };
    const body = req.body as Record<string, unknown> | undefined;
    const role = typeof body?.role === 'string' ? body.role : '';
    const v = new Validator();
    if (!ROLE_VALUES.includes(role as Role)) v.add('role', 'Choose a role.');
    v.throwIfAny();
    const target = await state.db.query('SELECT * FROM members WHERE id = $1 AND workspace_id = $2', [memberId, auth.workspaceId]);
    if (!target.rows[0]) throw new ApiError('not_found');
    if (target.rows[0].role === 'launch_producer' && role !== 'launch_producer') {
      const others = await state.db.query("SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'launch_producer' AND id <> $2", [auth.workspaceId, memberId]);
      if (others.rows[0].n === 0) throw new ApiError('last_producer');
    }
    let stockistId = target.rows[0].stockist_id;
    if (role === 'stockist_buyer') {
      if (!stockistId) {
        const first = await state.db.query('SELECT id FROM stockists WHERE workspace_id = $1 AND status = $2 LIMIT 1', [auth.workspaceId, 'active']);
        stockistId = first.rows[0]?.id ?? null;
      }
    } else stockistId = null;
    await state.db.query('UPDATE members SET role = $1, stockist_id = $2 WHERE id = $3', [role, stockistId, memberId]);
    const member = await state.db.query('SELECT * FROM members WHERE id = $1', [memberId]);
    reply.code(200).send(memberOut(member.rows[0]));
  });

  app.delete('/api/members/:memberId', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = requireRole(req, ['launch_producer']);
    const state = req.appState;
    const { memberId } = req.params as { memberId: string };
    const target = await state.db.query('SELECT * FROM members WHERE id = $1 AND workspace_id = $2', [memberId, auth.workspaceId]);
    if (!target.rows[0]) throw new ApiError('not_found');
    if (target.rows[0].role === 'launch_producer') {
      const others = await state.db.query("SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'launch_producer' AND id <> $2", [auth.workspaceId, memberId]);
      if (others.rows[0].n === 0) throw new ApiError('last_producer');
    }
    await state.db.query('DELETE FROM members WHERE id = $1', [memberId]);
    await state.db.query('DELETE FROM sessions WHERE member_id = $1', [memberId]);
    reply.code(204).send();
  });
}
