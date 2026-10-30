import { HttpException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DbService } from '../db.service';
import { MailService } from '../mail.service';
import { AuthService, MemberContext } from '../auth/auth.service';
import { invitationToken, signSession } from '../auth/tokens';
import { UUID } from './projects.controller';
import { SEAT_CREDITS, SEAT_LIMIT } from '../../shared/catalog';
import { checkEmail, validateAccount } from '../../shared/forms';

@Injectable()
export class TeamService {
  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
    private readonly auth: AuthService
  ) {}

  async read(member: MemberContext) {
    const members = await this.db.query(
      `select id, name, email, role, created_at as joined_at from users
        where workspace_id = $1 and removed_at is null order by created_at asc`,
      [member.workspace.id]
    );
    const invitations = await this.db.query(
      `select id, email, created_at from invitations
        where workspace_id = $1 and status = 'pending' order by created_at asc`,
      [member.workspace.id]
    );
    return {
      members: members.rows,
      invitations: invitations.rows,
      seats_used: members.rowCount! + invitations.rowCount!,
      seat_limit: SEAT_LIMIT
    };
  }

  /** The role and plan check that guards every team change, run before any id is read. */
  private requireTeamOwner(member: MemberContext): void {
    if (member.user.role !== 'owner' || member.workspace.plan !== 'team') {
      throw new HttpException({ error: 'forbidden' }, 403);
    }
  }

  async invite(member: MemberContext, body: { email?: unknown }) {
    this.requireTeamOwner(member);
    const invalid = checkEmail(body.email);
    if (invalid) throw new HttpException({ errors: { email: invalid } }, 422);
    const email = String(body.email).trim();

    const invitation = await this.db.transaction(async (client) => {
      await this.db.lockWorkspace(client, member.workspace.id);
      const taken = await client.query(
        `select 1 from users where lower(email) = lower($1) and removed_at is null
         union all
         select 1 from invitations where workspace_id = $2 and lower(email) = lower($1) and status = 'pending'`,
        [email, member.workspace.id]
      );
      if (taken.rowCount) {
        throw new HttpException({ error: 'That person already has an account or an invitation.' }, 409);
      }
      const seats = await client.query<{ count: number }>(
        `select (select count(*) from users where workspace_id = $1 and removed_at is null)
              + (select count(*) from invitations where workspace_id = $1 and status = 'pending') as count`,
        [member.workspace.id]
      );
      if (Number(seats.rows[0].count) >= SEAT_LIMIT) {
        throw new HttpException({ error: `Your team already uses all ${SEAT_LIMIT} seats.` }, 409);
      }
      const inserted = await client.query<{ id: string; email: string; token: string; created_at: Date }>(
        `insert into invitations (workspace_id, email, token, status)
         values ($1, $2, $3, 'pending') returning id, email, token, created_at`,
        [member.workspace.id, email, invitationToken()]
      );
      return inserted.rows[0];
    });

    await this.mail.send({
      to: invitation.email,
      subject: `${member.user.name} invited you to ${member.workspace.name} on Kinora`,
      text: [
        `${member.user.name} invited you to join ${member.workspace.name} on Kinora.`,
        '',
        `Open this link to set your name and password and join the team:`,
        this.mail.publicUrl(`/invite/${invitation.token}`),
        '',
        'The workspace shares one credit balance, and your seat adds 6,900 credits to it.'
      ].join('\n')
    });

    return { id: invitation.id, email: invitation.email, created_at: invitation.created_at };
  }

  async revoke(member: MemberContext, id: string) {
    this.requireTeamOwner(member);
    if (!UUID.test(id)) throw new HttpException({ error: 'not_found' }, 404);
    const revoked = await this.db.query(
      `update invitations set status = 'revoked'
        where id = $1 and workspace_id = $2 and status = 'pending' returning id`,
      [id, member.workspace.id]
    );
    if (!revoked.rowCount) throw new HttpException({ error: 'not_found' }, 404);
    return { ok: true };
  }

  async removeMember(member: MemberContext, id: string) {
    this.requireTeamOwner(member);
    if (!UUID.test(id)) throw new HttpException({ error: 'not_found' }, 404);
    if (id === member.user.id) throw new HttpException({ error: 'cannot_remove_self' }, 409);
    const removed = await this.db.query(
      `update users set removed_at = now(), token_version = token_version + 1
        where id = $1 and workspace_id = $2 and removed_at is null returning id`,
      [id, member.workspace.id]
    );
    if (!removed.rowCount) throw new HttpException({ error: 'not_found' }, 404);
    return { ok: true };
  }

  async readInvitation(token: string) {
    const result = await this.db.query<{ workspace_name: string; email: string }>(
      `select w.name as workspace_name, i.email from invitations i join workspaces w on w.id = i.workspace_id
        where i.token = $1 and i.status = 'pending'`,
      [token]
    );
    if (!result.rows[0]) throw new HttpException({ error: 'This invitation is no longer valid.' }, 404);
    return result.rows[0];
  }

  /** Joining creates the member and adds exactly one seat of credits to the shared pool. */
  async accept(token: string, body: { name?: unknown; password?: unknown }) {
    const errors = validateAccount(body);
    if (Object.keys(errors).length) throw new HttpException({ errors }, 422);
    const name = String(body.name).trim();
    const passwordHash = await bcrypt.hash(String(body.password), 10);

    return this.db.transaction(async (client) => {
      const invitation = await client.query<{ id: string; workspace_id: string; email: string }>(
        `select id, workspace_id, email from invitations
          where token = $1 and status = 'pending' for update`,
        [token]
      );
      if (!invitation.rows[0]) throw new HttpException({ error: 'This invitation is no longer valid.' }, 404);
      const { id, workspace_id: workspaceId, email } = invitation.rows[0];
      await this.db.lockWorkspace(client, workspaceId);
      const user = await this.auth.createAccount(client, {
        workspaceId,
        name,
        email,
        passwordHash,
        role: 'member'
      });
      await client.query(`update invitations set status = 'accepted', accepted_at = now() where id = $1`, [id]);
      await this.db.addCreditEntry(client, {
        workspaceId,
        kind: 'seat',
        amount: SEAT_CREDITS,
        userId: user.id,
        generationId: null
      });
      return {
        token: signSession({ uid: user.id, v: 0 }),
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      };
    });
  }
}
