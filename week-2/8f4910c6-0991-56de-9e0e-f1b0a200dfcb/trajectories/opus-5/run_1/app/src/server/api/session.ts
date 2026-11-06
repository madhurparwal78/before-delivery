import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { newToken } from '../ids.js';
import { conflict, gone, notFound, ApiError } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import {
  createMember,
  createSession,
  endSession,
  findMemberByEmail,
  findMemberById,
  hashPassword,
  listMembers,
  memberView,
  revokeMemberSessions,
  ROLE_HOMES,
  STAFF_ROLES,
  verifyPassword,
  type MemberRow,
} from '../data/members.js';
import { FieldErrors, EMAIL_PATTERN, cleanSingleLine, fieldCopy, json, readString } from './helpers.js';
import { invitationEmail, passwordResetEmail } from '../emails.js';
import { queueMail } from '../services/mail.js';
import { findTalentById } from '../data/talent.js';
import type { OfficeId, Role } from '../../shared/types.js';

const ACCOUNT_REPLY_RESET = 'If that address has an account, a reset link is on its way.';
const ACCOUNT_REPLY_INVITE = 'If that address has no account yet, an invitation is on its way.';

function sessionCookie(token: string): string {
  return `rb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

const CLEARED_COOKIE = 'rb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

async function signedInReply(member: MemberRow, nowMs: number): Promise<Reply> {
  const token = await createSession(member.id, nowMs);
  return json(
    200,
    { member: memberView(member), home: ROLE_HOMES[member.role] },
    { 'Set-Cookie': sessionCookie(token) },
  );
}

const ROLES: Role[] = ['agency_director', 'booker', 'accounts_lead', 'scout', 'talent'];
const OFFICE_IDS: OfficeId[] = ['toronto', 'vancouver'];

export const sessionRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/session',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = new FieldErrors();
      const email = cleanSingleLine(readString(ctx.json, 'email') ?? '');
      const password = readString(ctx.json, 'password') ?? '';
      if (!email) fields.add('email', fieldCopy.required('Email'));
      if (!password) fields.add('password', fieldCopy.required('Password'));
      fields.throwIfAny();
      const member = await findMemberByEmail(email);
      if (!member || !(await verifyPassword(password, member.password_hash))) {
        throw new ApiError(401, { error: 'invalid_credentials' });
      }
      return signedInReply(member, ctx.nowMs);
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      if (ctx.sessionToken) await endSession(ctx.sessionToken, ctx.nowMs);
      return { status: 204, headers: { 'Set-Cookie': CLEARED_COOKIE } };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => json(200, memberView(ctx.member as MemberRow)),
  },
  {
    method: 'POST',
    path: '/api/password-resets',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const email = cleanSingleLine(readString(ctx.json, 'email') ?? '');
      const member = email ? await findMemberByEmail(email) : null;
      if (member) {
        const token = newToken();
        await query('UPDATE password_resets SET superseded = true WHERE member_id = $1 AND used_at IS NULL', [
          member.id,
        ]);
        await query('INSERT INTO password_resets (token, member_id, email) VALUES ($1, $2, $3)', [
          token,
          member.id,
          member.email,
        ]);
        await queueMail(passwordResetEmail({ recipient: member.email, token }));
      }
      return json(202, { message: ACCOUNT_REPLY_RESET });
    },
  },
  {
    method: 'POST',
    path: '/api/password-resets/:token',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await queryOne<{ token: string; member_id: string; used_at: Date | null; superseded: boolean }>(
        'SELECT * FROM password_resets WHERE token = $1',
        [ctx.params.token],
      );
      if (!row) throw notFound();
      if (row.used_at || row.superseded) throw gone('link_used');
      const password = readString(ctx.json, 'password') ?? '';
      const fields = new FieldErrors();
      if (!password) fields.add('password', fieldCopy.required('New password'));
      else if (password.length < 12) fields.add('password', fieldCopy.password());
      fields.throwIfAny();
      const member = await findMemberById(row.member_id);
      if (!member) throw notFound();
      await query('UPDATE members SET password_hash = $2 WHERE id = $1', [
        member.id,
        await hashPassword(password),
      ]);
      await query('UPDATE password_resets SET used_at = $2 WHERE token = $1', [row.token, new Date(ctx.nowMs)]);
      return signedInReply(member, ctx.nowMs);
    },
  },
  {
    method: 'POST',
    path: '/api/invitations',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = new FieldErrors();
      const email = cleanSingleLine(readString(ctx.json, 'email') ?? '');
      const name = cleanSingleLine(readString(ctx.json, 'name') ?? '');
      const role = readString(ctx.json, 'role') ?? '';
      const office = readString(ctx.json, 'office') ?? '';
      const talentId = readString(ctx.json, 'talentId');
      if (!name) fields.add('name', fieldCopy.required('Name'));
      if (!email) fields.add('email', fieldCopy.required('Email'));
      else if (!EMAIL_PATTERN.test(email)) fields.add('email', fieldCopy.email());
      if (!ROLES.includes(role as Role)) fields.add('role', fieldCopy.required('Role'));
      if (!OFFICE_IDS.includes(office as OfficeId)) fields.add('office', fieldCopy.required('Office'));
      if (role === 'talent') {
        const talent = talentId ? await findTalentById(talentId) : null;
        if (!talent || talent.state !== 'active') fields.add('talentId', fieldCopy.required('Talent'));
      }
      fields.throwIfAny();
      const existing = await findMemberByEmail(email);
      if (!existing) {
        const token = newToken();
        await query('UPDATE invitations SET superseded = true WHERE lower(email) = lower($1) AND used_at IS NULL', [
          email,
        ]);
        await query(
          `INSERT INTO invitations (token, email, name, role, office_id, talent_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [token, email, name, role, office, role === 'talent' ? talentId : null],
        );
        await queueMail(invitationEmail({ recipient: email, name, token }));
      }
      return json(202, { message: ACCOUNT_REPLY_INVITE });
    },
  },
  {
    method: 'POST',
    path: '/api/invitations/:token/accept',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await queryOne<{
        token: string;
        email: string;
        name: string;
        role: Role;
        office_id: OfficeId;
        talent_id: string | null;
        used_at: Date | null;
        superseded: boolean;
      }>('SELECT * FROM invitations WHERE token = $1', [ctx.params.token]);
      if (!row) throw notFound();
      if (row.used_at || row.superseded) throw gone('link_used');
      const password = readString(ctx.json, 'password') ?? '';
      const fields = new FieldErrors();
      if (!password) fields.add('password', fieldCopy.required('New password'));
      else if (password.length < 12) fields.add('password', fieldCopy.password());
      fields.throwIfAny();
      const member = await createMember({
        name: row.name,
        email: row.email,
        role: row.role,
        office: row.office_id,
        talentId: row.talent_id,
        passwordHash: await hashPassword(password),
      });
      await query('UPDATE invitations SET used_at = $2 WHERE token = $1', [row.token, new Date(ctx.nowMs)]);
      return signedInReply(member, ctx.nowMs);
    },
  },
  {
    method: 'GET',
    path: '/api/members',
    auth: 'session',
    roles: STAFF_ROLES,
    handler: async (): Promise<Reply> =>
      json(200, { members: (await listMembers()).map((row) => memberView(row)) }),
  },
  {
    method: 'GET',
    path: '/api/members/:id',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const caller = ctx.member as MemberRow;
      const row = await findMemberById(ctx.params.id);
      if (!row) throw notFound();
      if (caller.role === 'talent' && row.id !== caller.id) throw notFound();
      return json(200, memberView(row));
    },
  },
  {
    method: 'PATCH',
    path: '/api/members/:id',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findMemberById(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const caller = ctx.member as MemberRow;
      if (caller.id === ctx.params.id) throw conflict('own_membership');
      const role = readString(ctx.json, 'role') ?? '';
      const fields = new FieldErrors();
      if (!ROLES.includes(role as Role)) fields.add('role', fieldCopy.required('Role'));
      fields.throwIfAny();
      const rows = await query<MemberRow>('UPDATE members SET role = $2 WHERE id = $1 RETURNING *', [
        ctx.params.id,
        role,
      ]);
      return json(200, memberView(rows[0]));
    },
  },
  {
    method: 'DELETE',
    path: '/api/members/:id',
    auth: 'session',
    roles: ['agency_director'],
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findMemberById(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const caller = ctx.member as MemberRow;
      if (caller.id === ctx.params.id) throw conflict('own_membership');
      await revokeMemberSessions(ctx.params.id, ctx.nowMs);
      await query('DELETE FROM members WHERE id = $1', [ctx.params.id]);
      return { status: 204 };
    },
  },
];
