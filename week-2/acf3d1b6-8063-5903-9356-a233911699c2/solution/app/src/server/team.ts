import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { SEAT_CREDITS, SEAT_LIMIT } from '../shared/catalog.js';
import { checkInvite, checkJoin } from '../shared/rules.js';
import { AuthService, hashPassword, setSessionCookie, userJson } from './auth.js';
import { config } from './config.js';
import { CreditsService } from './credits.js';
import { Database, isUniqueViolation, type Queryable } from './database.js';
import { invalid, recordId, refuse } from './errors.js';
import { Mailer } from './mail.js';
import type { Member, SignedInRequest } from './session.js';

/** Inviting, revoking and removing belong to the owner of a Team workspace; this check comes before any lookup. */
function requireTeamOwner(member: Member): void {
  if (member.role !== 'owner' || member.workspace.plan !== 'team') throw refuse(403, 'forbidden');
}

async function seatsUsed(client: Queryable, workspaceId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM users WHERE removed_at IS NULL AND workspace_id = $1)
          + (SELECT COUNT(*) FROM invitations WHERE status = 'pending' AND workspace_id = $1) AS n`,
    [workspaceId],
  );
  return Number(rows[0].n);
}

@Injectable()
export class TeamService {
  constructor(
    private readonly db: Database,
    private readonly credits: CreditsService,
    private readonly auth: AuthService,
    private readonly mailer: Mailer,
  ) {}

  async invite(member: Member, body: Record<string, unknown>) {
    requireTeamOwner(member);
    const checked = checkInvite(body);
    if (!checked.ok) throw invalid(checked.errors);
    const { email } = checked.value;
    const workspaceId = member.workspace.id;
    const token = randomBytes(32).toString('base64url');
    let invitation;
    try {
      invitation = await this.db.transaction(async (client) => {
        await this.db.lockWorkspace(client, workspaceId);
        const account = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
        if (account.rowCount) throw refuse(409, 'account_or_invitation_exists');
        if ((await seatsUsed(client, workspaceId)) >= SEAT_LIMIT) throw refuse(409, 'seats_full');
        const { rows } = await client.query(
          `INSERT INTO invitations (workspace_id, email, token, status) VALUES ($1, $2, $3, 'pending')
           RETURNING id, email, created_at`,
          [workspaceId, email, token],
        );
        return rows[0];
      });
    } catch (error) {
      if (isUniqueViolation(error, 'invitations_pending_key')) throw refuse(409, 'account_or_invitation_exists');
      throw error;
    }
    await this.mailer.send({
      to: email,
      subject: `${member.name} invited you to ${member.workspace.name} on Kinora`,
      text:
        `${member.name} invited you to join ${member.workspace.name} on Kinora.\n\n` +
        `Your team shares one credit balance, and your seat adds ${SEAT_CREDITS.toLocaleString('en-US')} credits to it the moment you join.\n\n` +
        `Join the team: ${config.publicUrl}/invite/${token}\n`,
    });
    return invitation;
  }

  async revoke(member: Member, id: string): Promise<void> {
    requireTeamOwner(member);
    const { rowCount } = await this.db.query(
      `UPDATE invitations SET status = 'revoked' WHERE id = $1 AND workspace_id = $2 AND status = 'pending'`,
      [recordId(id), member.workspace.id],
    );
    if (!rowCount) throw refuse(404, 'not_found');
  }

  async remove(member: Member, id: string): Promise<void> {
    requireTeamOwner(member);
    const userId = recordId(id);
    await this.db.transaction(async (client) => {
      const target = await client.query(
        'SELECT 1 FROM users WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL FOR UPDATE',
        [userId, member.workspace.id],
      );
      if (!target.rowCount) throw refuse(404, 'not_found');
      if (userId === member.id) throw refuse(409, 'cannot_remove_self');
      await client.query(`UPDATE users SET removed_at = now(), session_hashes = '{}' WHERE id = $1`, [userId]);
    });
  }

  async invitationByToken(token: string) {
    const { rows } = await this.db.query<{ workspace_name: string; email: string }>(
      `SELECT w.name AS workspace_name, i.email FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.token = $1 AND i.status = 'pending'`,
      [token],
    );
    return rows[0];
  }

  /** Accepting an invitation creates the member, marks it accepted and adds one seat of credits, together. */
  async join(token: string, body: Record<string, unknown>) {
    const checked = checkJoin(body);
    if (!checked.ok) throw invalid(checked.errors);
    const passwordHash = await hashPassword(checked.value.password);
    try {
      return await this.db.transaction(async (client) => {
        const invitation = await client.query<{ id: string; workspace_id: string; email: string }>(
          `SELECT id, workspace_id, email FROM invitations WHERE token = $1 AND status = 'pending' FOR UPDATE`,
          [token],
        );
        const pending = invitation.rows[0];
        if (!pending) throw refuse(404, 'not_found');
        await this.db.lockWorkspace(client, pending.workspace_id);
        const user = await client.query<{ id: string; name: string; email: string; role: 'member' }>(
          `INSERT INTO users (workspace_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'member')
           RETURNING id, name, email, role`,
          [pending.workspace_id, checked.value.name, pending.email, passwordHash],
        );
        const joined = user.rows[0];
        await client.query(`UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = $1`, [pending.id]);
        await this.credits.record(client, {
          workspaceId: pending.workspace_id,
          kind: 'seat',
          amount: SEAT_CREDITS,
          userId: joined.id,
        });
        return { token: await this.auth.startSession(client, joined.id), user: userJson(joined) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) throw refuse(409, 'account_or_invitation_exists');
      throw error;
    }
  }
}

@Controller('team')
export class TeamController {
  constructor(
    private readonly db: Database,
    private readonly team: TeamService,
  ) {}

  @Get()
  async read(@Req() req: SignedInRequest) {
    const workspaceId = req.member.workspace.id;
    const [members, invitations, used] = await Promise.all([
      this.db.query(
        `SELECT id, name, email, role, created_at AS joined_at FROM users
          WHERE removed_at IS NULL AND workspace_id = $1 ORDER BY created_at`,
        [workspaceId],
      ),
      this.db.query(
        `SELECT id, email, created_at FROM invitations
          WHERE status = 'pending' AND workspace_id = $1 ORDER BY created_at DESC`,
        [workspaceId],
      ),
      seatsUsed(this.db, workspaceId),
    ]);
    return { members: members.rows, invitations: invitations.rows, seats_used: used, seat_limit: SEAT_LIMIT };
  }

  @Post('invitations')
  invite(@Req() req: SignedInRequest, @Body() body: Record<string, unknown>) {
    return this.team.invite(req.member, body ?? {});
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  revoke(@Req() req: SignedInRequest, @Param('id') id: string) {
    return this.team.revoke(req.member, id);
  }

  @Delete('members/:id')
  @HttpCode(204)
  remove(@Req() req: SignedInRequest, @Param('id') id: string) {
    return this.team.remove(req.member, id);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly team: TeamService) {}

  @Get(':token')
  async read(@Param('token') token: string) {
    const invitation = await this.team.invitationByToken(token);
    if (!invitation) throw refuse(404, 'not_found');
    return invitation;
  }

  @Post(':token')
  async join(@Param('token') token: string, @Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.team.join(token, body ?? {});
    setSessionCookie(res, result.token);
    return result;
  }
}
