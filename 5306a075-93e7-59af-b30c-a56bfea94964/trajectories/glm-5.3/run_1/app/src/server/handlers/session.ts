import { randomBytes, randomUUID } from "node:crypto";
import type { Route, RequestContext } from "../router.js";
import { errors } from "../errors.js";
import { hashPassword, verifyPassword } from "../seed.js";
import { audit } from "../audit.js";
import { clearSessionCookie, serializeSessionCookie } from "../router.js";

const ROLE_KEYS = ["head_of_product", "product_manager", "customer_success"] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

const ROLE_LABELS: Record<RoleKey, string> = {
  head_of_product: "Head of product",
  product_manager: "Product manager",
  customer_success: "Customer success",
};

function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  return value;
}

export function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const sessionRoutes: Route[] = [
  {
    pattern: ["health"],
    methods: ["GET"],
    roles: "public",
    handler: async (): Promise<{ status: number; body: unknown }> => ({
      status: 200,
      body: { status: "ok" },
    }),
  },
  {
    pattern: ["session"],
    methods: ["POST"],
    roles: "public",
    handler: async (ctx: RequestContext) => {
      const email = readString(ctx.body, "email")?.trim().toLowerCase() ?? "";
      const password = readString(ctx.body, "password") ?? "";
      const result = await ctx.pool.query<{
        id: string;
        workspace_id: string;
        name: string;
        email: string;
        role: string;
        password_hash: string;
      }>(
        "SELECT id, workspace_id, name, email, role, password_hash FROM members WHERE lower(email) = $1",
        [email],
      );
      const row = result.rows[0];
      if (row === undefined || !verifyPassword(password, row.password_hash)) {
        throw errors.invalidCredentials();
      }
      const token = randomBytes(32).toString("base64url");
      await ctx.pool.query(
        "INSERT INTO sessions (token, member_id, last_seen_at) VALUES ($1, $2, now())",
        [token, row.id],
      );
      await audit(ctx.pool, row.workspace_id, row.id, "sign_in", "member", row.id, null);
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": serializeSessionCookie(token),
        },
        body: {
          user: { id: row.id, name: row.name, email: row.email, role: row.role },
        },
      };
    },
  },
  {
    pattern: ["session"],
    methods: ["DELETE"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const { readSessionCookie } = await import("../router.js");
      const token = readSessionCookie(ctx.req.headers.cookie);
      if (token !== null) {
        await ctx.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
        await audit(
          ctx.pool,
          ctx.member!.workspaceId,
          ctx.member!.id,
          "sign_out",
          "member",
          ctx.member!.id,
          null,
        );
      }
      return {
        status: 204,
        headers: { "Set-Cookie": clearSessionCookie() },
      };
    },
  },
  {
    pattern: ["me"],
    methods: ["GET"],
    roles: "any",
    handler: async (ctx: RequestContext) => {
      const ws = await ctx.pool.query<{ id: string; name: string; time_zone: string }>(
        "SELECT id, name, time_zone FROM workspaces WHERE id = $1",
        [ctx.member!.workspaceId],
      );
      const workspace = ws.rows[0];
      if (workspace === undefined) throw errors.notFound();
      return {
        status: 200,
        body: {
          user: {
            id: ctx.member!.id,
            name: ctx.member!.name,
            email: ctx.member!.email,
            role: ctx.member!.role,
          },
          workspace: { id: workspace.id, name: workspace.name, timeZone: workspace.time_zone },
        },
      };
    },
  },
  {
    pattern: ["invitations"],
    methods: ["POST"],
    roles: ["head_of_product"],
    handler: async (ctx: RequestContext) => {
      const rawEmail = readString(ctx.body, "email") ?? "";
      const email = rawEmail.trim().toLowerCase();
      const role = readString(ctx.body, "role");
      if (role === null || !isRoleKey(role)) {
        throw errors.validationFailed({ role: "Pick a role." });
      }
      if (email.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw errors.validationFailed({ email: "Enter an email address." });
      }

      const existing = await ctx.pool.query<{ id: string }>(
        "SELECT id FROM members WHERE lower(email) = $1",
        [email],
      );
      if (existing.rowCount !== 0) throw errors.alreadyMember();

      const workspaceId = ctx.member!.workspaceId;
      const token = randomBytes(32).toString("base64url");
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + ctx.config.inviteTtlSeconds * 1000);
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        // A new invitation to the same email replaces the earlier one.
        await client.query(
          "UPDATE invitations SET replaced = TRUE WHERE workspace_id = $1 AND lower(email) = $2",
          [workspaceId, email],
        );
        await client.query(
          `INSERT INTO invitations (id, workspace_id, email, role, token, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, workspaceId, email, role, token, expiresAt],
        );
        const ws = await client.query<{ name: string }>(
          "SELECT name FROM workspaces WHERE id = $1",
          [workspaceId],
        );
        const workspaceName = ws.rows[0]?.name ?? "";
        const link = `${ctx.config.baseUrl}/invite/${token}`;
        const textBody =
          `You have been invited to join ${workspaceName} on Evidence Desk as ${ROLE_LABELS[role]}.\n\n` +
          `Open this link to accept:\n${link}\n`;
        const htmlBody =
          `<p>You have been invited to join <strong>${escapeText(workspaceName)}</strong> on Evidence Desk as ` +
          `${escapeText(ROLE_LABELS[role])}.</p><p><a href="${link}">Accept the invitation</a></p>`;
        await client.query(
          `INSERT INTO outbox (id, workspace_id, to_email, to_name, subject, text_body, html_body)
           VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
          [
            randomUUID(),
            workspaceId,
            email,
            `You're invited to ${workspaceName} on Evidence Desk`,
            textBody,
            htmlBody,
          ],
        );
        await audit(client, workspaceId, ctx.member!.id, "invite", "invitation", id, { email, role });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        throw err;
      }
      client.release();
      return {
        status: 201,
        body: { invitation: { id, email, role, expiresAt: iso(expiresAt) } },
      };
    },
  },
  {
    pattern: ["invitations", ":token"],
    methods: ["GET"],
    roles: "public",
    handler: async (ctx: RequestContext) => {
      const row = await loadInvitation(ctx, ctx.params.token!);
      return {
        status: 200,
        body: { email: row.email, role: row.role, workspaceName: row.workspace_name },
      };
    },
  },
  {
    pattern: ["invitations", ":token", "accept"],
    methods: ["POST"],
    roles: "public",
    handler: async (ctx: RequestContext) => {
      const row = await loadInvitation(ctx, ctx.params.token!);
      const name = readString(ctx.body, "name")?.trim() ?? "";
      const password = readString(ctx.body, "password") ?? "";
      const fields: Record<string, string> = {};
      if (name.length < 1 || name.length > 80) {
        fields.name = "Use between 1 and 80 characters.";
      }
      if (password.length < 12) {
        fields.password = "Use at least 12 characters.";
      }
      if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

      const memberId = randomUUID();
      const client = await ctx.pool.connect();
      let token: string;
      try {
        await client.query("BEGIN");
        const updated = await client.query<{ id: string }>(
          `UPDATE invitations SET accepted_at = now()
           WHERE id = $1 AND accepted_at IS NULL AND replaced = FALSE
           RETURNING id`,
          [row.id],
        );
        if (updated.rowCount === 0) {
          throw errors.invitationGone("invitation_used");
        }
        await client.query(
          `INSERT INTO members (id, workspace_id, name, email, password_hash, role)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [memberId, row.workspace_id, name, row.email, hashPassword(password), row.role],
        );
        token = randomBytes(32).toString("base64url");
        await client.query(
          "INSERT INTO sessions (token, member_id, last_seen_at) VALUES ($1, $2, now())",
          [token, memberId],
        );
        await audit(client, row.workspace_id, memberId, "accept_invitation", "member", memberId, null);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
        throw err;
      }
      client.release();
      return {
        status: 201,
        headers: { "Set-Cookie": serializeSessionCookie(token) },
        body: { user: { id: memberId, name, email: row.email, role: row.role } },
      };
    },
  },
];

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  workspace_name: string;
  accepted_at: Date | null;
  expires_at: Date;
  replaced: boolean;
}

async function loadInvitation(ctx: RequestContext, token: string): Promise<InvitationRow> {
  const result = await ctx.pool.query<InvitationRow>(
    `SELECT i.id, i.workspace_id, i.email, i.role, i.accepted_at, i.expires_at, i.replaced,
            w.name AS workspace_name
     FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
     WHERE i.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) throw errors.notFound();
  if (row.replaced) throw errors.invitationGone("invitation_replaced");
  if (row.accepted_at !== null) throw errors.invitationGone("invitation_used");
  if (row.expires_at.getTime() <= Date.now()) throw errors.invitationGone("invitation_expired");
  return row;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function readStringField(body: Record<string, unknown>, key: string): string | null {
  return readString(body, key);
}
