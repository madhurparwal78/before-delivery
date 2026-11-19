import type { Team, TeamMember } from "../shared/api";
import { limits, settings } from "./config";
import { pool, query, queryOne } from "./db";
import type { Db } from "./db";
import { ApiError, forbidden, mailUnavailable, notFound, validationFailed } from "./errors";
import { Context, defineRoute, reply } from "./http";
import type { Route } from "./http";
import { announceMembershipChanged } from "./live";
import { MailUnavailable, sendMail } from "./mail";
import { asRecord } from "../shared/records";
import { hashToken, newId, newToken } from "./session";

interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
}

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  role: "owner" | "member";
}

/** The team cap: a team holds at most `teamMax` members, its owner included. */
async function assertTeamHasRoom(db: Db, teamId: string): Promise<void> {
  const count = await queryOne<{ count: string }>(db, "SELECT count(*) FROM team_members WHERE team_id = $1", [teamId]);
  if (Number((count as { count: string }).count) >= limits.teamMax) {
    throw new ApiError(409, "team_full", `This team is full (${limits.teamMax} of ${limits.teamMax}).`);
  }
}

export async function addMember(db: Db, teamId: string, userId: string, role: "owner" | "member"): Promise<void> {
  await db.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [teamId, userId, role]);
}

export async function createTeam(db: Db, name: string, ownerId: string): Promise<string> {
  const id = newId("t");
  await db.query("INSERT INTO teams (id, name, owner_id) VALUES ($1, $2, $3)", [id, name, ownerId]);
  await addMember(db, id, ownerId, "owner");
  return id;
}

async function describeTeam(db: Db, team: TeamRow, viewerId: string): Promise<Team> {
  const members = await query<MemberRow>(
    db,
    `SELECT u.id, u.display_name, u.email, m.role FROM team_members m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = $1 ORDER BY (m.role = 'owner') DESC, m.joined_at, u.id`,
    [team.id],
  );
  const described: Team = {
    id: team.id,
    name: team.name,
    owner: team.owner_id,
    members: members.map((member): TeamMember => ({ id: member.id, displayName: member.display_name, email: member.email, role: member.role })),
  };
  if (team.owner_id === viewerId) {
    const invites = await query<{ email: string; expires_at: Date }>(
      db,
      "SELECT DISTINCT ON (email) email, expires_at FROM team_invites WHERE team_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY email, created_at DESC",
      [team.id],
    );
    described.invites = invites.map((invite) => ({ email: invite.email, expiresAt: invite.expires_at.toISOString() }));
  }
  return described;
}

/** The team a path names, if the caller belongs to it; teams of others do not exist for them. */
async function memberTeam(ctx: Context): Promise<TeamRow> {
  const team = await queryOne<TeamRow>(
    pool,
    `SELECT t.id, t.name, t.owner_id FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = $2 WHERE t.id = $1`,
    [ctx.params.id, ctx.me().id],
  );
  if (!team) throw notFound();
  return team;
}

async function ownedTeam(ctx: Context): Promise<TeamRow> {
  const team = await memberTeam(ctx);
  if (team.owner_id !== ctx.me().id) throw forbidden("Only the team owner can do this.");
  return team;
}

interface InviteRow {
  team_id: string;
  team_name: string;
  email: string;
  inviter_name: string;
  token_hash: string;
}

async function openInvite(ctx: Context): Promise<InviteRow> {
  const invite = await queryOne<InviteRow>(
    pool,
    `SELECT i.team_id, t.name AS team_name, i.email, u.display_name AS inviter_name, i.token_hash
     FROM team_invites i JOIN teams t ON t.id = i.team_id JOIN users u ON u.id = i.inviter_id
     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(ctx.params.token as string)],
  );
  if (!invite) throw notFound();
  return invite;
}

export const teamRoutes: Route[] = [
  defineRoute<undefined, string>({
    method: "POST", path: "/api/teams", access: "session", body: "json",
    validate: (body) => {
      const name = asRecord(body).name;
      if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 60) {
        throw validationFailed({ name: "Team name needs 1 to 60 characters." });
      }
      return name.trim();
    },
    run: async (ctx, _, name) => {
      const db = await ctx.transaction();
      const id = await createTeam(db, name, ctx.me().id);
      const team = (await queryOne<TeamRow>(db, "SELECT id, name, owner_id FROM teams WHERE id = $1", [id])) as TeamRow;
      return reply(201, { team: await describeTeam(db, team, ctx.me().id) });
    },
  }),
  defineRoute<TeamRow>({
    method: "GET", path: "/api/teams/:id", access: "session", resolve: memberTeam,
    run: async (ctx, team) => reply(200, { team: await describeTeam(pool, team, ctx.me().id) }),
  }),
  defineRoute<TeamRow, string>({
    method: "POST", path: "/api/teams/:id/invites", access: "session", body: "json", resolve: ownedTeam,
    check: async (_, team, body) => {
      await assertTeamHasRoom(pool, team.id);
      const email = asRecord(body).email;
      if (typeof email === "string") {
        const member = await queryOne(
          pool,
          "SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 AND lower(u.email) = $2",
          [team.id, email.trim().toLowerCase()],
        );
        if (member) throw new ApiError(409, "already_member", `${email.trim().toLowerCase()} is already in this team.`);
      }
    },
    validate: (body) => {
      const email = asRecord(body).email;
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw validationFailed({ email: "Enter a valid email address." });
      }
      return email.trim().toLowerCase();
    },
    run: async (ctx, team, email) => {
      const db = await ctx.transaction();
      const token = newToken();
      const invite = (await queryOne<{ expires_at: Date }>(
        db,
        `INSERT INTO team_invites (token_hash, team_id, email, inviter_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING expires_at`,
        [hashToken(token), team.id, email, ctx.me().id, settings.inviteTtlSeconds],
      )) as { expires_at: Date };
      try {
        await sendMail(
          email,
          `Join ${team.name} on Wringbench`,
          `${ctx.me().displayName} invited you to join ${team.name} on Wringbench:\n\n${settings.publicUrl}/invite/${token}\n`,
        );
      } catch (error) {
        if (error instanceof MailUnavailable) throw mailUnavailable();
        throw error;
      }
      return reply(201, { invite: { email, expiresAt: invite.expires_at.toISOString() } });
    },
  }),
  defineRoute<InviteRow>({
    method: "GET", path: "/api/invites/:token", access: "public", resolve: openInvite,
    run: async (_, invite) => reply(200, { invite: { teamName: invite.team_name, inviterName: invite.inviter_name, email: invite.email } }),
  }),
  defineRoute<InviteRow>({
    method: "POST", path: "/api/invites/:token/accept", access: "session", resolve: openInvite,
    check: async (ctx, invite) => {
      if (ctx.me().email.toLowerCase() !== invite.email) {
        throw new ApiError(403, "invite_wrong_account", `This invite was sent to ${invite.email}.`);
      }
    },
    run: async (ctx, invite) => {
      const db = await ctx.transaction();
      await db.query("SELECT 1 FROM teams WHERE id = $1 FOR UPDATE", [invite.team_id]);
      await assertTeamHasRoom(db, invite.team_id);
      await addMember(db, invite.team_id, ctx.me().id, "member");
      await db.query("UPDATE team_invites SET used_at = now() WHERE token_hash = $1", [invite.token_hash]);
      const team = (await queryOne<TeamRow>(db, "SELECT id, name, owner_id FROM teams WHERE id = $1", [invite.team_id])) as TeamRow;
      ctx.afterCommit(() => announceMembershipChanged(invite.team_id));
      return reply(200, { team: await describeTeam(db, team, ctx.me().id) });
    },
  }),
  defineRoute<TeamRow>({
    method: "DELETE", path: "/api/teams/:id/members/:userId", access: "session", resolve: ownedTeam,
    check: async (ctx, team) => {
      const target = ctx.params.userId as string;
      if (!(await queryOne(pool, "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2", [team.id, target]))) throw notFound();
      if (target === team.owner_id) throw new ApiError(409, "cannot_remove_owner", "The owner cannot be removed.");
    },
    run: async (ctx, team) => {
      const target = ctx.params.userId as string;
      await (await ctx.transaction()).query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", [team.id, target]);
      ctx.afterCommit(() => announceMembershipChanged(team.id, [target]));
      return reply(204);
    },
  }),
];
