import { bodyLimits, config } from '../config.js';
import { newId, pool } from '../db.js';
import { apiErrors } from '../errors.js';
import type { Router } from '../http.js';
import { publish } from '../live.js';
import { MailDown, sendInviteEmail } from '../mail.js';
import {
  hashToken,
  isTeamMember,
  newToken,
  teamBody,
  teamMemberCount,
  teamMemberIds,
} from '../store.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function registerTeamRoutes(router: Router): void {
  router.add('POST', '/api/teams', async (ctx) => {
    const session = ctx.requireSession();
    const body = await ctx.readJson(bodyLimits.json);
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (name.length < 1 || name.length > 60) {
      throw apiErrors.validation({ name: 'A team name needs 1 to 60 characters.' });
    }
    const id = newId('t');
    await pool.query('insert into teams (id, name, owner_id) values ($1, $2, $3)', [id, name, session.userId]);
    await pool.query("insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')", [
      id,
      session.userId,
    ]);
    ctx.json(201, { team: await teamBody(id, true) });
  });

  router.add('GET', '/api/teams/:id', async (ctx) => {
    const session = ctx.requireSession();
    const id = ctx.params['id']!;
    if (!(await isTeamMember(id, session.userId))) throw apiErrors.notFound();
    ctx.json(200, { team: await teamBody(id, true) });
  });

  router.add('POST', '/api/teams/:id/invites', async (ctx) => {
    const session = ctx.requireSession();
    const id = ctx.params['id']!;
    const team = await teamBody(id, false);
    if (team === null || !(await isTeamMember(id, session.userId))) throw apiErrors.notFound();
    if (team.owner !== session.userId) throw apiErrors.ownerOnly();
    const body = await ctx.readJson(bodyLimits.json);
    const email = typeof body['email'] === 'string' ? body['email'].trim() : '';
    if ((await teamMemberCount(id)) >= config.limits.teamMax) throw apiErrors.teamFull(config.limits.teamMax);
    if (team.members.some((member) => member.email.toLowerCase() === email.toLowerCase())) {
      throw apiErrors.alreadyMember(email);
    }
    if (!EMAIL_PATTERN.test(email)) throw apiErrors.validation({ email: 'Enter an email address.' });
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.limits.inviteTtlSeconds * 1000);
    try {
      await pool.query(
        `insert into invites (token_hash, team_id, email, inviter_id, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [hashToken(token), id, email, session.userId, expiresAt],
      );
      await sendInviteEmail(email, team.name, session.displayName, token);
    } catch (cause) {
      await pool.query('delete from invites where token_hash = $1', [hashToken(token)]);
      if (cause instanceof MailDown) throw apiErrors.mailUnavailable();
      throw cause;
    }
    ctx.json(201, { invite: { email, expiresAt: expiresAt.toISOString() } });
  });

  router.add(
    'GET',
    '/api/invites/:token',
    async (ctx) => {
      const result = await pool.query<{ team_name: string; inviter_name: string; email: string }>(
        `select t.name as team_name, u.display_name as inviter_name, i.email
         from invites i join teams t on t.id = i.team_id join users u on u.id = i.inviter_id
         where i.token_hash = $1 and i.spent = false and i.expires_at > now()`,
        [hashToken(ctx.params['token']!)],
      );
      const row = result.rows[0];
      if (row === undefined) throw apiErrors.notFound();
      ctx.json(200, {
        invite: { teamName: row.team_name, inviterName: row.inviter_name, email: row.email },
      });
    },
    true,
  );

  router.add('POST', '/api/invites/:token/accept', async (ctx) => {
    const session = ctx.requireSession();
    const tokenHash = hashToken(ctx.params['token']!);
    const result = await pool.query<{ team_id: string; email: string }>(
      `select team_id, email from invites
       where token_hash = $1 and spent = false and expires_at > now()`,
      [tokenHash],
    );
    const invite = result.rows[0];
    if (invite === undefined) throw apiErrors.notFound();
    if (invite.email.toLowerCase() !== session.email.toLowerCase()) {
      throw apiErrors.inviteWrongAccount(invite.email);
    }
    if (!(await isTeamMember(invite.team_id, session.userId))) {
      if ((await teamMemberCount(invite.team_id)) >= config.limits.teamMax) {
        throw apiErrors.teamFull(config.limits.teamMax);
      }
      await pool.query("insert into team_members (team_id, user_id, role) values ($1, $2, 'member')", [
        invite.team_id,
        session.userId,
      ]);
    }
    await pool.query('update invites set spent = true where token_hash = $1', [tokenHash]);
    publish(await teamMemberIds(invite.team_id), { type: 'membership_changed', teamId: invite.team_id });
    ctx.json(200, { team: await teamBody(invite.team_id, true) });
  });

  router.add('DELETE', '/api/teams/:id/members/:userId', async (ctx) => {
    const session = ctx.requireSession();
    const id = ctx.params['id']!;
    const memberId = ctx.params['userId']!;
    const team = await teamBody(id, false);
    if (team === null || !(await isTeamMember(id, session.userId))) throw apiErrors.notFound();
    if (team.owner !== session.userId) throw apiErrors.ownerOnly();
    if (!team.members.some((member) => member.id === memberId)) throw apiErrors.notFound();
    if (team.owner === memberId) throw apiErrors.cannotRemoveOwner();
    const audience = await teamMemberIds(id);
    await pool.query('delete from team_members where team_id = $1 and user_id = $2', [id, memberId]);
    publish(audience, { type: 'membership_changed', teamId: id });
    ctx.empty(204);
  });
}
