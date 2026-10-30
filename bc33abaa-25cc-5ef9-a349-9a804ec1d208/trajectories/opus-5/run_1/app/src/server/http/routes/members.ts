import { Express } from 'express';
import { Role } from '../../../shared/api';
import { config } from '../../config';
import { query, transaction } from '../../db/pool';
import { INVITATION_TTL_SECONDS, addSeconds, toIso } from '../../domain/time';
import {
  MemberRow,
  activeMembers,
  seatsPurchased,
  seatsUsed,
  writeAudit,
} from '../../domain/workspace';
import { releaseAllLocksOf } from '../../domain/scenes';
import { enqueueMail } from '../../services/mail';
import { hashPassword, randomId, sha256Hex, urlSafeToken } from '../../util/crypto';
import { fail } from '../errors';
import {
  body,
  param,
  queryInteger,
  requireCaller,
  requirePermission,
  requireString,
  setSessionCookie,
} from '../context';
import { route } from '../route';
import { createSession, memberDto } from './auth';

const INVITABLE_ROLES: Role[] = ['admin', 'billing_manager', 'editor', 'viewer'];

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  token_sha256: string;
  invited_by_id: string;
  invited_by_name: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export function registerMemberRoutes(app: Express): void {
  app.get(
    '/api/members',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'workspace.read');
      const members = await activeMembers(context.workspace.id);
      const invites = await query<InvitationRow>(
        `SELECT * FROM invitations
         WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         ORDER BY created_at`,
        [context.workspace.id],
      );
      res.json({
        members: members.map(memberDto),
        invites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: toIso(invite.expires_at),
          invitedBy: { kind: 'member', id: invite.invited_by_id, name: invite.invited_by_name },
        })),
      });
    }),
  );

  app.post(
    '/api/members/invites',
    route(async (req, res) => {
      const input = body(req);
      const context = await requireCaller(req);
      requirePermission(context, 'member.invite');
      const email = requireString(input, 'email', { min: 3, max: 200 });
      const roleRaw = input.role;
      if (typeof roleRaw !== 'string' || !INVITABLE_ROLES.includes(roleRaw as Role)) {
        throw fail.validation({ role: 'Must be admin, billing_manager, editor or viewer' });
      }
      const role = roleRaw as Role;
      if (
        role === 'admin' &&
        context.caller.kind === 'member' &&
        context.caller.role === 'billing_manager'
      ) {
        throw fail.forbidden();
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw fail.validation({ email: 'Must be an email address' });
      }

      const invitation = await transaction(async (client) => {
        await client.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [
          context.workspace.id,
        ]);
        const duplicate = await client.query<{ id: string }>(
          `SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND lower(email) = lower($2)
           UNION ALL
           SELECT id FROM invitations
             WHERE workspace_id = $1 AND lower(email) = lower($2)
               AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
          [context.workspace.id, email],
        );
        if (duplicate.rows.length > 0) throw fail.conflict('already_member');
        const used = await seatsUsed(context.workspace.id, client);
        const purchased = seatsPurchased(context.subscription);
        if (used >= purchased) {
          throw fail.conflict('no_seats_left', { seatsUsed: used, seatsPurchased: purchased });
        }
        const token = urlSafeToken(32);
        const rows = await client.query<InvitationRow>(
          `INSERT INTO invitations (id, workspace_id, email, role, token_sha256, invited_by_id, invited_by_name, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            randomId('inv'),
            context.workspace.id,
            email,
            role,
            sha256Hex(token),
            context.author.id,
            context.author.name,
            addSeconds(new Date(), INVITATION_TTL_SECONDS),
          ],
        );
        const row = rows.rows[0] as InvitationRow;
        await writeAudit(
          {
            workspaceId: context.workspace.id,
            actor: context.author,
            action: 'member.invited',
            target: { type: 'invitation', id: row.id },
          },
          client,
        );
        await enqueueMail(
          {
            dedupeKey: `invite:${row.id}`,
            workspaceId: context.workspace.id,
            to: [email],
            fromName: `${context.author.name} via Orrery Studio`,
            subject: `Join ${context.workspace.name} on Orrery Studio`,
            body: [
              `${context.author.name} invited you to ${context.workspace.name} on Orrery Studio.`,
              '',
              `${config.publicUrl}/invite/${token}`,
              '',
              'The link works for seven days.',
            ].join('\n'),
          },
          client,
        );
        return row;
      });

      res.status(201).json({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: toIso(invitation.expires_at),
      });
    }),
  );

  app.delete(
    '/api/members/invites/:inviteId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<InvitationRow>(
        `SELECT * FROM invitations WHERE id = $1 AND workspace_id = $2`,
        [param(req, 'inviteId'), context.workspace.id],
      );
      const invitation = rows[0];
      if (!invitation) throw fail.notFound();
      requirePermission(context, 'member.invite');
      await query(`UPDATE invitations SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
        invitation.id,
      ]);
      await writeAudit({
        workspaceId: context.workspace.id,
        actor: context.author,
        action: 'invite.revoked',
        target: { type: 'invitation', id: invitation.id },
      });
      res.status(204).end();
    }),
  );

  app.get(
    '/api/invites/:token',
    route(async (req, res) => {
      const rows = await query<InvitationRow & { workspace_name: string }>(
        `SELECT i.*, w.name AS workspace_name
         FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
         WHERE i.token_sha256 = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
        [sha256Hex(param(req, 'token'))],
      );
      const invitation = rows[0];
      if (!invitation) throw fail.notFound();
      res.json({
        workspace: { name: invitation.workspace_name },
        email: invitation.email,
        role: invitation.role,
      });
    }),
  );

  app.post(
    '/api/invites/:token/accept',
    route(async (req, res) => {
      const input = body(req);
      const name = requireString(input, 'name', { min: 1, max: 80 });
      const password = requireString(input, 'password', {
        min: 10,
        max: 200,
        message: 'Must be at least 10 characters',
      });
      const rows = await query<InvitationRow & { workspace_name: string; time_zone: string }>(
        `SELECT i.*, w.name AS workspace_name, w.time_zone
         FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
         WHERE i.token_sha256 = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
        [sha256Hex(param(req, 'token'))],
      );
      const invitation = rows[0];
      if (!invitation) throw fail.notFound();
      const subscription = await query<{ state: string }>(
        `SELECT state FROM subscriptions WHERE workspace_id = $1`,
        [invitation.workspace_id],
      );
      const state = subscription[0]?.state;
      if (state === 'suspended' || state === 'cancelled') throw fail.workspaceReadOnly();
      const taken = await query<{ id: string }>(
        `SELECT id FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL`,
        [invitation.email],
      );
      if (taken.length > 0) throw fail.conflict('email_taken');

      const memberId = randomId('mem');
      const member = await transaction(async (client) => {
        const inserted = await client.query<MemberRow>(
          `INSERT INTO members (id, workspace_id, name, email, role, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            memberId,
            invitation.workspace_id,
            name,
            invitation.email,
            invitation.role,
            hashPassword(password),
          ],
        );
        await client.query(`UPDATE invitations SET accepted_at = now() WHERE id = $1`, [
          invitation.id,
        ]);
        await writeAudit(
          {
            workspaceId: invitation.workspace_id,
            actor: { kind: 'member', id: memberId, name },
            action: 'member.joined',
            target: { type: 'member', id: memberId },
          },
          client,
        );
        return inserted.rows[0] as MemberRow;
      });
      const token = await createSession(memberId, invitation.workspace_id);
      setSessionCookie(res, token);
      res.status(201).json({
        member: memberDto(member),
        workspace: {
          id: invitation.workspace_id,
          name: invitation.workspace_name,
          timeZone: invitation.time_zone,
        },
      });
    }),
  );

  app.delete(
    '/api/members/:memberId',
    route(async (req, res) => {
      const context = await requireCaller(req);
      const rows = await query<MemberRow>(
        `SELECT * FROM members WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL`,
        [param(req, 'memberId'), context.workspace.id],
      );
      const member = rows[0];
      if (!member) throw fail.notFound();
      requirePermission(context, 'member.manage');
      if (member.role === 'owner') throw fail.conflict('owner_cannot_be_removed');
      await transaction(async (client) => {
        await client.query(`UPDATE members SET removed_at = now() WHERE id = $1`, [member.id]);
        await client.query(
          `UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL`,
          [member.id],
        );
        await writeAudit(
          {
            workspaceId: context.workspace.id,
            actor: context.author,
            action: 'member.removed',
            target: { type: 'member', id: member.id },
          },
          client,
        );
      });
      await releaseAllLocksOf(context.workspace.id, member.id);
      res.status(204).end();
    }),
  );

  app.get(
    '/api/audit',
    route(async (req, res) => {
      const context = await requireCaller(req);
      requirePermission(context, 'member.manage');
      const limit = queryInteger(req, 'limit', { min: 1, max: 500, fallback: 100 });
      const rows = await query<{
        id: string;
        at: Date;
        actor_kind: 'member' | 'agent' | 'system';
        actor_id: string;
        actor_name: string;
        action: string;
        target_type: string;
        target_id: string;
      }>(
        `SELECT id, at, actor_kind, actor_id, actor_name, action, target_type, target_id
         FROM audit_entries WHERE workspace_id = $1
         ORDER BY at DESC, ordinal DESC
         LIMIT $2`,
        [context.workspace.id, limit],
      );
      res.json({
        entries: rows.map((row) => ({
          id: row.id,
          at: toIso(row.at),
          actor: { kind: row.actor_kind, id: row.actor_id, name: row.actor_name },
          action: row.action,
          target: { type: row.target_type, id: row.target_id },
        })),
      });
    }),
  );
}
