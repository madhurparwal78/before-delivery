import { randomBytes } from "node:crypto";
import type { Role } from "../../shared/api.js";
import { config } from "../config.js";
import { db, type Queryable } from "../db.js";
import { invitationEmail } from "../domain/emails.js";
import { iso } from "../domain/time.js";
import { hashPassword, sessionCookie, startSession, toUser } from "../http/auth.js";
import { ApiError, conflict, notFound } from "../http/errors.js";
import { H, member, open, type Router } from "../http/router.js";
import { Fields } from "../http/validate.js";
import { kick } from "../services/workers.js";
import { audit } from "./records.js";

const ROLES: Role[] = ["head_of_product", "product_manager", "customer_success"];

interface InvitationRow {
  id: string; workspace_id: string; workspace_name: string; email: string; role: Role;
  expires_at: Date; used_at: Date | null; replaced_at: Date | null;
}

const alreadyMember = (email: string) => conflict("already_member", `${email} already has an Evidence Desk account.`);

/** The invitation behind a token, or the 410 that applies: replaced, then used, then expired. */
async function usableInvitation(q: Queryable, token: string, lock: boolean): Promise<InvitationRow> {
  const [row] = await q.query<InvitationRow>(
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role, i.expires_at, i.used_at, i.replaced_at
       FROM invitations i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = $1 ${lock ? "FOR UPDATE OF i" : ""}`,
    [token],
  );
  if (!row) throw notFound();
  if (row.replaced_at !== null) throw new ApiError(410, "invitation_replaced", "This invitation was replaced by a newer one");
  if (row.used_at !== null) throw new ApiError(410, "invitation_used", "This invitation has already been used");
  if (row.expires_at.getTime() <= Date.now()) throw new ApiError(410, "invitation_expired", "This invitation has expired");
  return row;
}

export function invitationRoutes(router: Router): void {
  router.add("/api/invitations", {
    POST: member({
      roles: H,
      handle: async (ctx) => {
        const ws = ctx.session.workspace;
        const fields = new Fields(ctx.body);
        const email = fields.text("email", { min: 3, max: 254, message: "Enter an email address." }).toLowerCase();
        if (fields.ok("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.fail("email", "Enter an email address.");
        if (fields.ok("email") && (await db.query("SELECT 1 FROM members WHERE lower(email) = $1", [email])).length > 0) throw alreadyMember(email);
        const role = fields.oneOf("role", ROLES, "Choose a role.");
        fields.check();
        const token = randomBytes(32).toString("base64url");
        const invitation = await db.transaction(async (tx) => {
          await tx.query("SELECT pg_advisory_xact_lock(hashtext('invite:' || $1))", [email]);
          await tx.query("UPDATE invitations SET replaced_at = now() WHERE lower(email) = $1 AND replaced_at IS NULL AND used_at IS NULL", [email]);
          const [row] = await tx.query<{ id: string; expires_at: Date }>(
            `INSERT INTO invitations (workspace_id, email, role, token, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) RETURNING id, expires_at`,
            [ws.id, email, role, token, ctx.session.member.id, config.inviteTtlSeconds],
          );
          const mail = invitationEmail({ workspaceName: ws.name, role, link: `${config.baseUrl}/invite/${token}` });
          await tx.query(
            "INSERT INTO outbox (workspace_id, recipient_name, recipient_email, subject, text_body, html_body) VALUES ($1, '', $2, $3, $4, $5)",
            [ws.id, email, mail.subject, mail.text, mail.html],
          );
          await audit(tx, ctx, ws.id, "invitation.sent", row.id, { email, role });
          return { id: row.id, email, role, expiresAt: iso(row.expires_at) };
        });
        kick("outbox");
        return { status: 201, json: { invitation } };
      },
    }),
  });

  router.add("/api/invitations/:token", {
    GET: open({
      handle: async (ctx) => {
        const invitation = await usableInvitation(db, ctx.params.token ?? "", false);
        return { status: 200, json: { email: invitation.email, role: invitation.role, workspaceName: invitation.workspace_name } };
      },
    }),
  });

  router.add("/api/invitations/:token/accept", {
    POST: open({
      handle: async (ctx) => {
        const fields = new Fields(ctx.body);
        const { user, token } = await db.transaction(async (tx) => {
            const invitation = await usableInvitation(tx, ctx.params.token ?? "", true);
            const name = fields.text("name", { min: 1, max: 80, message: "Add your name." });
            fields.text("password", { min: 12, max: 1000, message: "Use at least 12 characters.", trim: false });
            fields.check();
            if ((await tx.query("SELECT 1 FROM members WHERE lower(email) = $1", [invitation.email])).length > 0) throw alreadyMember(invitation.email);
            const password = String(ctx.body.password);
            const [created] = await tx.query<{ id: string }>(
              "INSERT INTO members (workspace_id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [invitation.workspace_id, name, invitation.email, invitation.role, await hashPassword(password)],
            );
            await tx.query("UPDATE invitations SET used_at = now() WHERE id = $1", [invitation.id]);
            await audit(tx, null, invitation.workspace_id, "invitation.accepted", invitation.id, { memberId: created.id });
            const member = { id: created.id, workspaceId: invitation.workspace_id, name, email: invitation.email, role: invitation.role };
            return { user: toUser(member), token: await startSession(tx, created.id) };
        });
        return { status: 201, json: { user }, headers: { "Set-Cookie": sessionCookie(token) } };
      },
    }),
  });
}
