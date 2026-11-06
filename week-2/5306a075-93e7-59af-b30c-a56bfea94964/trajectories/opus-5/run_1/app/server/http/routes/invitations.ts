import type { Role, User } from '../../../shared/types';
import { newId, newToken, withTransaction } from '../../db';
import { conflict, gone, notFound } from '../../errors';
import { env } from '../../env';
import { toInstant } from '../../domain/zone';
import { createSession, hashPassword, recordAudit } from '../../repo/session';
import { enqueueEmail, renderInvitationEmail } from '../../services/mail';
import { Router, requirePrincipal, type RequestContext } from '../kernel';
import { FieldErrors, failField } from '../validate';

const ROLES: Role[] = ['head_of_product', 'product_manager', 'customer_success'];

interface InvitationRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: Role;
  expires_at: Date;
  used_at: Date | null;
  replaced_at: Date | null;
}

async function loadInvitation(ctx: RequestContext): Promise<InvitationRow> {
  const { rows } = await ctx.db.query<InvitationRow>(
    `SELECT invitations.id, invitations.workspace_id, workspaces.name AS workspace_name,
            invitations.email, invitations.role, invitations.expires_at,
            invitations.used_at, invitations.replaced_at
       FROM invitations
       JOIN workspaces ON workspaces.id = invitations.workspace_id
      WHERE invitations.token = $1`,
    [ctx.params.token],
  );
  const invitation = rows[0];
  if (!invitation) throw notFound();
  return invitation;
}

/** When more than one applies, replaced is reported first, then used, then expired. */
function assertUsable(invitation: InvitationRow): void {
  if (invitation.replaced_at !== null) {
    throw gone('invitation_replaced', 'This invitation was replaced by a newer one.');
  }
  if (invitation.used_at !== null) throw gone('invitation_used', 'This invitation has already been used.');
  if (invitation.expires_at.getTime() <= Date.now()) {
    throw gone('invitation_expired', 'This invitation has expired.');
  }
}

export function registerInvitationRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/invitations',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) errors.add('email', 'Use an email address.');
      const role = ctx.body.role;
      if (typeof role !== 'string' || !ROLES.includes(role as Role)) errors.add('role', 'Choose a role.');
      errors.throwIfAny();

      const { rows: existing } = await ctx.db.query<{ id: string }>(
        'SELECT id FROM members WHERE lower(email) = $1',
        [email],
      );
      if (existing.length > 0) {
        throw conflict('already_member', `${email} already has an Evidence Desk account.`);
      }

      const id = newId();
      const token = newToken();
      const expiresAt = new Date(Date.now() + env.inviteTtlSeconds * 1000);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE invitations SET replaced_at = now()
            WHERE workspace_id = $1 AND lower(email) = $2 AND used_at IS NULL AND replaced_at IS NULL`,
          [principal.workspaceId, email],
        );
        await client.query(
          `INSERT INTO invitations (id, workspace_id, invited_by, email, role, token, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, principal.workspaceId, principal.memberId, email, role, token, expiresAt.toISOString()],
        );
        await enqueueEmail(
          client,
          principal.workspaceId,
          null,
          { name: email, email },
          renderInvitationEmail({
            workspaceName: principal.workspaceName,
            role: role as Role,
            token,
          }),
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'invitation.create',
          'invitation',
          id,
          { email, role },
        );
      });
      return {
        status: 201,
        json: { invitation: { id, email, role, expiresAt: toInstant(expiresAt) } },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/invitations/:token',
    access: 'public',
    handle: async (ctx) => {
      const invitation = await loadInvitation(ctx);
      assertUsable(invitation);
      return {
        status: 200,
        json: {
          email: invitation.email,
          role: invitation.role,
          workspaceName: invitation.workspace_name,
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/invitations/:token/accept',
    access: 'public',
    handle: async (ctx) => {
      const invitation = await loadInvitation(ctx);
      assertUsable(invitation);
      const errors = new FieldErrors();
      const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name === '' || name.length > 80) errors.add('name', 'Use 1 to 80 characters.');
      const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
      if (password.length < 12) errors.add('password', 'Use at least 12 characters.');
      errors.throwIfAny();

      const memberId = newId();
      try {
        await withTransaction(async (client) => {
          const { rowCount } = await client.query(
            'UPDATE invitations SET used_at = now() WHERE id = $1 AND used_at IS NULL',
            [invitation.id],
          );
          if (rowCount === 0) throw gone('invitation_used', 'This invitation has already been used.');
          await client.query(
            `INSERT INTO members (id, workspace_id, name, email, role, password_hash)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [memberId, invitation.workspace_id, name, invitation.email, invitation.role, hashPassword(password)],
          );
          await recordAudit(
            client,
            invitation.workspace_id,
            memberId,
            'invitation.accept',
            'member',
            memberId,
          );
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505') {
          failField('name', 'This email already has an Evidence Desk account.');
        }
        throw error;
      }
      const token = await createSession(memberId);
      const user: User = {
        id: memberId,
        name,
        email: invitation.email,
        role: invitation.role,
      };
      return { status: 201, json: { user }, setSession: token };
    },
  });
}
