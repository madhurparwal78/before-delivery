import { createSession, hashPassword, type Principal } from '../auth';
import { config } from '../config';
import { db, one, transaction } from '../db';
import { fail } from '../errors';
import { emit } from '../events';
import { endpoint, reply, sessionCookie } from '../http';
import { newId, newToken } from '../ids';
import { Fields } from '../input';
import { deliverInvite, INVITE_COLUMNS, inviteJson, loadInvite, loadInviteByToken, requireInvite, type InviteRow } from '../domain/invites';
import type { MemberJson, Role, TeamJson } from '../../shared/types';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The team screen's data: its members and every invite. */
export async function loadTeam(principal: Principal): Promise<TeamJson> {
  const [members, invites] = await Promise.all([
    db.query<MemberJson>('select id as user_id, name, email, role from users where team_id = $1 order by created_at, id', [principal.teamId]),
    db.query<InviteRow>(`select ${INVITE_COLUMNS} from invites where team_id = $1 order by created_at, id`, [principal.teamId]),
  ]);
  return { id: principal.teamId, name: principal.teamName, members, invites: invites.map(inviteJson) };
}

export function teamRoutes(): void {
  endpoint('GET', '/api/team', {
    access: 'owner',
    handle: async (ctx) => reply.json(200, await loadTeam(ctx.principal)),
  });

  endpoint('POST', '/api/team/invites', {
    access: 'owner',
    body: 'json',
    handle: async (ctx) => {
      const fields = new Fields(ctx.json);
      const email = fields.text('email', 320).toLowerCase();
      const role = fields.oneOf('role', ['editor', 'viewer'] as const);
      const id = newId('inv');
      await transaction(async (tx) => {
        await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`invite:${ctx.principal.teamId}:${email}`]);
        if (email !== '' && (await one(tx, 'select 1 as x from users where email = $1', [email])) !== null) {
          throw fail.emailInUse();
        }
        const pending = await one(tx, "select 1 as x from invites where team_id = $1 and email = $2 and status in ('held', 'sent') and expires_at > now()", [ctx.principal.teamId, email]);
        if (pending !== null) {
          throw fail.invitePending();
        }
        if (email !== '' && !EMAIL.test(email)) {
          fields.problems.email = 'Enter a valid email address.';
        }
        fields.check();
        await tx.query(
          `insert into invites (id, team_id, inviter_id, email, role, token, status, expires_at)
           values ($1, $2, $3, $4, $5, $6, 'held', now() + ($7 || ' milliseconds')::interval)`,
          [id, ctx.principal.teamId, ctx.principal.user.id, email, role, newToken(), String(config.inviteTtlMs)],
        );
      });
      const invite = await requireInvite(db, id);
      const sent = await deliverInvite(invite);
      const current = await requireInvite(db, id);
      if (!sent) {
        emit('invite', inviteJson(current), { teamId: current.teamId });
      }
      return reply.json(sent ? 201 : 202, inviteJson(current));
    },
  });

  endpoint('POST', '/api/team/invites/:inviteId/send', {
    access: 'owner',
    prepare: async (ctx) => {
      const invite = await loadInvite(db, ctx.params.inviteId ?? '');
      if (invite === null || invite.teamId !== ctx.principal.teamId) {
        throw fail.notFound();
      }
      return invite;
    },
    handle: async (_ctx, invite) => {
      if (invite.status === 'held' && !(await deliverInvite(invite))) {
        throw fail.mailUnavailable();
      }
      return reply.json(200, inviteJson(await requireInvite(db, invite.id)));
    },
  });

  endpoint('PUT', '/api/team/members/:userId', {
    access: 'owner',
    body: 'json',
    prepare: async (ctx) => {
      const member = await one<MemberJson>(db, 'select id as user_id, name, email, role from users where id = $1 and team_id = $2', [ctx.params.userId, ctx.principal.teamId]);
      if (member === null) {
        throw fail.notFound();
      }
      return member;
    },
    handle: async (ctx, member) => {
      const fields = new Fields(ctx.json);
      const role: Role = fields.oneOf('role', ['editor', 'viewer'] as const);
      fields.check();
      const changed = await db.query("update users set role = $2 where id = $1 and role <> 'owner' returning id", [member.userId, role]);
      if (changed.length === 0) {
        throw fail.ownerRoleFixed();
      }
      emit('role', { userId: member.userId, role }, { teamId: ctx.principal.teamId });
      return reply.json(200, { ...member, role });
    },
  });

  endpoint('POST', '/api/invites/:token/accept', {
    access: 'public',
    body: 'json',
    handle: async (ctx) => {
      const invite = await loadInviteByToken(ctx.params.token ?? '');
      if (invite === null || invite.status === 'accepted' || invite.expired) {
        throw fail.inviteInvalid();
      }
      const fields = new Fields(ctx.json);
      const name = fields.text('name', 100);
      const password = fields.raw('password');
      if (password.length < 10 || password.length > 200) {
        fields.problems.password = 'Passwords have 10 to 200 characters.';
      }
      fields.check();
      const hash = await hashPassword(password);
      const userId = newId('usr');
      const joined = await transaction(async (tx) => {
        const claimed = await tx.query("update invites set status = 'accepted' where id = $1 and status in ('held', 'sent') and expires_at > now() returning id", [invite.id]);
        if (claimed.length === 0) {
          return false;
        }
        await tx.query('insert into users (id, team_id, email, name, password_hash, role) values ($1, $2, $3, $4, $5, $6)', [userId, invite.teamId, invite.email, name, hash, invite.role]);
        return true;
      });
      if (!joined) {
        throw fail.inviteInvalid();
      }
      emit('invite', inviteJson(await requireInvite(db, invite.id)), { teamId: invite.teamId });
      const token = await createSession(userId);
      return reply.json(201, { user: { id: userId, email: invite.email, name } }, { 'Set-Cookie': sessionCookie(token) });
    },
  });
}
