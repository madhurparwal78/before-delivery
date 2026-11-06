import type pg from "pg";
import { config } from "../config.js";
import {
  hashPassword, isStudio, MEMBER_COLUMNS, MEMBER_FROM, memberById, memberFromRow, memberRef, newToken, requireRole, ROLES,
  startSession, STUDIO_ORGANISATION, tokenHash, type Member, type Role,
} from "../auth.js";
import { one, pool, rows, tx } from "../db.js";
import { conflict, notFound, staleVersion } from "../http/errors.js";
import type { PageRule } from "../http/pages.js";
import { noContent, ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { queueMail } from "../services/mail.js";
import { knownId } from "../scope.js";

const ROLE_LABEL: Record<Role, string> = {
  director: "studio director", project_lead: "project lead", designer: "designer", finance: "studio finance",
  client_approver: "client approver", contractor: "contractor",
};
const MAX_LIMIT_CENTS = 99_999_999_999;

/** The member object published to the studio. */
const studioJson = (member: Member) => ({
  id: member.id, name: member.name, email: member.email, phone: member.phone, role: member.role,
  organisation: member.organisation, status: member.status, approvalLimits: member.approvalLimits, version: member.version,
});

type MemberRowShape = Parameters<typeof memberFromRow>[0];

async function allMembers(db: pg.PoolClient | typeof pool): Promise<Member[]> {
  return (await rows<MemberRowShape>(db, `SELECT ${MEMBER_COLUMNS} FROM ${MEMBER_FROM} ORDER BY m.created_at, m.name`)).map(memberFromRow);
}

/**
 * Members a client approver or contractor may see: their own organisation, the studio, and the other side of
 * every project they share.
 */
async function sharedMembers(viewer: Member): Promise<Member[]> {
  const everyone = (await allMembers(pool)).filter((m) => m.status === "active");
  let partners: string[];
  if (viewer.role === "client_approver") {
    partners = (await rows<{ company_id: string }>(pool,
      "SELECT k.company_id FROM contracts k JOIN projects p ON p.id = k.project_id WHERE p.brand_id = $1", [viewer.brandId])).map((r) => r.company_id);
  } else {
    partners = (await rows<{ brand_id: string }>(pool,
      "SELECT p.brand_id FROM contracts k JOIN projects p ON p.id = k.project_id WHERE k.company_id = $1", [viewer.companyId])).map((r) => r.brand_id);
  }
  return everyone.filter((m) => {
    if (m.organisation === viewer.organisation && m.role === viewer.role) return true;
    if (isStudio(m)) return true;
    if (viewer.role === "client_approver") return m.role === "contractor" && !!m.companyId && partners.includes(m.companyId);
    return m.role === "client_approver" && !!m.brandId && partners.includes(m.brandId);
  });
}

interface InvitationRow {
  id: string; email: string; name: string; role: Role; phone: string | null; brand_id: string | null; company_id: string | null;
  approval_limit_hkd: number | null; approval_limit_sgd: number | null; organisation: string;
}

/** A usable invitation: unused and unexpired. */
async function liveInvitation(db: pg.PoolClient | typeof pool, token: string, lock = false): Promise<InvitationRow | undefined> {
  return one<InvitationRow>(db,
    `SELECT i.id, i.email, i.name, i.role, i.phone, i.brand_id, i.company_id, i.approval_limit_hkd, i.approval_limit_sgd,
       CASE WHEN i.role = 'client_approver' THEN b.name WHEN i.role = 'contractor' THEN c.name ELSE '${STUDIO_ORGANISATION}' END AS organisation
     FROM invitations i LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN companies c ON c.id = i.company_id
     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() ${lock ? "FOR UPDATE OF i" : ""}`, [tokenHash(token)]);
}

/** Approval limits in each currency, read from `{"HKD": cents, "SGD": cents}`. */
function limits(fields: Fields, value: unknown): { HKD: number; SGD: number } {
  const source = record(value);
  return {
    HKD: fields.cents("approvalLimits.HKD", "Approval limit HKD", { min: 0, max: MAX_LIMIT_CENTS }, source.HKD ?? 0),
    SGD: fields.cents("approvalLimits.SGD", "Approval limit SGD", { min: 0, max: MAX_LIMIT_CENTS }, source.SGD ?? 0),
  };
}

async function directorTarget(ctx: Parameters<Route["handler"]>[0], db: pg.PoolClient) {
  const row = await one<MemberRowShape>(db, `SELECT ${MEMBER_COLUMNS} FROM ${MEMBER_FROM} WHERE m.id = $1 FOR UPDATE OF m`, [knownId(ctx.params.id)]);
  if (!row) throw notFound();
  requireRole(ctx.me, "director");
  const target = memberFromRow(row);
  if (target.id === ctx.me.id) throw conflict("own_membership");
  return target;
}

async function versionConflict(db: pg.PoolClient, target: Member, version: unknown): Promise<void> {
  if (version === target.version) return;
  const saved = await one<{ name: string | null; at: Date }>(db,
    "SELECT u.name, m.updated_at AS at FROM members m LEFT JOIN members u ON u.id = m.updated_by WHERE m.id = $1", [target.id]);
  throw staleVersion(saved?.name ?? "Marrow Hall Interiors", (saved?.at ?? new Date()).toISOString());
}

export const routes: Route[] = [
  {
    method: "GET", path: "/api/members", auth: "member",
    handler: async (ctx) => {
      if (isStudio(ctx.me)) return ok({ members: (await allMembers(pool)).map(studioJson) });
      return ok({ members: (await sharedMembers(ctx.me)).map(memberRef) });
    },
  },
  {
    method: "POST", path: "/api/invitations", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, "director");
      const body = record(ctx.json());
      if (typeof body.email === "string" && body.email.trim()
        && await one(pool, "SELECT 1 FROM members WHERE lower(email) = lower($1)", [body.email.trim()])) {
        throw conflict("member_exists");
      }
      const fields = new Fields(body);
      const email = fields.email("email", "Email");
      const name = fields.text("name", "Name", { max: 120, oneLine: true });
      const role = fields.oneOf("role", "Role", ROLES);
      const phone = fields.text("phone", "Phone", { min: 0, max: 30, oneLine: true });
      let brandId: string | null = null;
      let companyName = "";
      if (role === "client_approver" && !fields.has("role")) {
        const brand = typeof body.brandId === "string" && /^[0-9a-f-]{36}$/i.test(body.brandId)
          ? await one<{ id: string }>(pool, "SELECT id FROM brands WHERE id = $1", [body.brandId]) : undefined;
        if (!brand) fields.fail("brandId", "Brand is required.");
        brandId = brand?.id ?? null;
      }
      if (role === "contractor" && !fields.has("role")) companyName = fields.text("companyName", "Company name", { max: 120, oneLine: true });
      const approval = role === "project_lead" ? limits(fields, body.approvalLimits) : null;
      fields.done();
      const token = newToken();
      const invitation = await tx(async (client) => {
        let companyId: string | null = null;
        if (companyName) {
          await client.query("INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [companyName]);
          companyId = (await one<{ id: string }>(client, "SELECT id FROM companies WHERE name = $1", [companyName]))?.id ?? null;
        }
        const saved = await one<{ id: string; email: string; role: string; expires_at: Date }>(client,
          `INSERT INTO invitations (token_hash, email, name, role, phone, brand_id, company_id, approval_limit_hkd, approval_limit_sgd, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))
           RETURNING id, email, role, expires_at`,
          [tokenHash(token), email, name, role, phone || null, brandId, companyId, approval?.HKD ?? null, approval?.SGD ?? null,
            ctx.me.id, config.invitationTtlSeconds]);
        await queueMail(client, {
          to: email,
          subject: "You're invited to Marrow Hall Interiors on Plumbline",
          text: [
            `Hello ${name},`,
            "",
            `${ctx.me.name} has invited you to join Marrow Hall Interiors on Plumbline as a ${ROLE_LABEL[role]}.`,
            "",
            "Set your name and password here:",
            `${config.baseUrl}/invite/${token}`,
            "",
            "The link works once.",
          ].join("\n"),
        });
        return saved;
      });
      return ok({ invitation: invitation && {
        id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expires_at.toISOString(),
      } }, 201);
    },
  },
  {
    method: "GET", path: "/api/invitations/:token", auth: "public",
    handler: async (ctx) => {
      const invitation = await liveInvitation(pool, ctx.params.token);
      if (!invitation) throw notFound();
      return ok({ invitation: { email: invitation.email, name: invitation.name, role: invitation.role, organisation: invitation.organisation } });
    },
  },
  {
    method: "POST", path: "/api/invitations/:token/accept", auth: "public",
    handler: async (ctx) => tx(async (client) => {
      const invitation = await liveInvitation(client, ctx.params.token, true);
      if (!invitation) throw notFound();
      if (await one(client, "SELECT 1 FROM members WHERE lower(email) = lower($1)", [invitation.email])) throw conflict("member_exists");
      const body = record(ctx.json());
      const fields = new Fields(body);
      const name = fields.text("name", "Your name", { max: 120, oneLine: true });
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) fields.fail("password", "Choose a password is required.");
      else if ([...password].length < 12 || [...password].length > 128) fields.fail("password", "Choose a password must be between 12 and 128 characters.");
      fields.done();
      const created = await one<{ id: string }>(client,
        `INSERT INTO members (email, name, phone, role, brand_id, company_id, password_hash, approval_limit_hkd, approval_limit_sgd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [invitation.email, name, invitation.phone, invitation.role, invitation.brand_id, invitation.company_id,
          await hashPassword(password), invitation.approval_limit_hkd, invitation.approval_limit_sgd]);
      await client.query("UPDATE invitations SET used_at = now() WHERE id = $1", [invitation.id]);
      const member = await memberById(client, created?.id ?? "");
      return ok({ member: member && memberRef(member) }, 201, { "Set-Cookie": await startSession(client, created?.id ?? "") });
    }),
  },
  {
    method: "PATCH", path: "/api/members/:id", auth: "member",
    handler: async (ctx) => tx(async (client) => {
      const target = await directorTarget(ctx, client);
      const body = record(ctx.json());
      await versionConflict(client, target, body.version);
      const fields = new Fields(body);
      const role = body.role === undefined ? target.role : fields.oneOf("role", "Role", ROLES);
      if (role === "client_approver" && !target.brandId) fields.fail("role", "Invite client approvers with their brand.");
      if (role === "contractor" && !target.companyId) fields.fail("role", "Invite contractors with their company.");
      const approval = role === "project_lead"
        ? (body.approvalLimits === undefined ? target.approvalLimits ?? { HKD: 0, SGD: 0 } : limits(fields, body.approvalLimits))
        : null;
      fields.done();
      await client.query(
        `UPDATE members SET role = $2, approval_limit_hkd = $3, approval_limit_sgd = $4, version = version + 1,
           updated_by = $5, updated_at = now() WHERE id = $1`,
        [target.id, role, approval?.HKD ?? null, approval?.SGD ?? null, ctx.me.id]);
      const saved = await memberById(client, target.id);
      return ok({ member: saved && studioJson(saved) });
    }),
  },
  {
    method: "DELETE", path: "/api/members/:id", auth: "member",
    handler: async (ctx) => tx(async (client) => {
      const target = await directorTarget(ctx, client);
      await client.query("UPDATE members SET status = 'removed', version = version + 1, updated_by = $2, updated_at = now() WHERE id = $1",
        [target.id, ctx.me.id]);
      return noContent();
    }),
  },
];

export const pages: PageRule[] = [
  { path: "/invite/:token", exists: async (params) => !!(await liveInvitation(pool, params.token)) },
];
