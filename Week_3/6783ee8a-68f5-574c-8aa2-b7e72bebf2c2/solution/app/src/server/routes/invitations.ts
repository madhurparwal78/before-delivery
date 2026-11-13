import type { PoolClient } from "pg";
import type { ShareRole } from "../../shared/api";
import { pool, queryOne } from "../db";
import { ApiError, notFound } from "../errors";
import { Context, defineRoute, reply } from "../http";
import { markStale, runIndexer } from "../search";
import { hashToken } from "../session";

interface Invitation {
  share_id: string;
  notebook_id: string;
  email: string;
  role: ShareRole;
  user_id: string | null;
  status: string;
}

export async function invitationFor(db: Pick<PoolClient, "query">, token: string): Promise<Invitation | null> {
  return queryOne<Invitation>(
    db,
    "SELECT id AS share_id, notebook_id, email, role, user_id, status FROM shares WHERE token_hash = $1",
    [hashToken(token)],
  );
}

/** Makes the invited person an active reader of the notebook; opening the link again changes nothing. */
export async function acceptInvitation(ctx: Context, db: PoolClient, invitation: Invitation, userId: string): Promise<void> {
  if (invitation.status === "active" && invitation.user_id === userId) return;
  await db.query("UPDATE shares SET user_id = $1, status = 'active' WHERE id = $2", [userId, invitation.share_id]);
  await markStale(db, invitation.notebook_id);
  ctx.afterCommit(() => void runIndexer());
}

export const readInvitation = defineRoute({
  method: "GET",
  path: "/api/invitations/:token",
  access: "public",
  run: async (ctx) => {
    const row = await queryOne<{ email: string; role: ShareRole; notebook_title: string; owner_display_name: string; account_exists: boolean }>(
      pool,
      `SELECT s.email, s.role, n.title AS notebook_title, o.display_name AS owner_display_name,
              EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(s.email)) AS account_exists
         FROM shares s JOIN notebooks n ON n.id = s.notebook_id JOIN users o ON o.id = n.owner_id
        WHERE s.token_hash = $1`,
      [hashToken(ctx.params.token as string)],
    );
    if (!row) throw notFound();
    return reply(200, row);
  },
});

export const acceptInvitationRoute = defineRoute({
  method: "POST",
  path: "/api/invitations/:token/accept",
  access: "session",
  run: async (ctx) => {
    const db = await ctx.transaction();
    const invitation = await invitationFor(db, ctx.params.token as string);
    if (!invitation) throw notFound();
    if (invitation.email.toLowerCase() !== ctx.me().email.toLowerCase()) {
      throw new ApiError(403, "invitation_for_another_account", "This invitation is for another account.");
    }
    await acceptInvitation(ctx, db, invitation, ctx.me().id);
    return reply(200, { notebook_id: invitation.notebook_id });
  },
});
