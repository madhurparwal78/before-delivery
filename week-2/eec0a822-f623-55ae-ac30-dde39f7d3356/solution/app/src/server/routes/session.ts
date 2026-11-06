import { randomUUID } from "node:crypto";
import { endSession, sessionMember, hashPassword, HOME, memberByEmail, ROLES, sessionCookie, startSession, verifyPassword, type Member, type Role } from "../auth";
import { one, pool, rows, transaction } from "../db";
import { ApiError, conflict, notFound, type Json } from "../http";
import { route } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { yachtBySlug } from "../domain/yachts";

function sessionJson(member: Member): Json {
  return {
    member: { id: member.id, name: member.name, role: member.role, workspaceSlug: member.workspaceSlug, workspaceName: member.workspaceName },
    homePath: `/w/${member.workspaceSlug}/${HOME[member.role]}`,
  };
}

route("POST", "/api/session", {
  handle: async (ctx) => {
    const body = asBody(await ctx.json());
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const found = email ? await memberByEmail(pool, email) : undefined;
    const valid = await verifyPassword(password, found?.password_hash ?? null);
    if (!found || !valid) throw new ApiError(401, { error: "invalid_credentials" });
    const { token, maxAge } = await startSession(found.id);
    return { status: 200, body: sessionJson(await sessionMember(found.id)), headers: { "Set-Cookie": sessionCookie(token, maxAge) } };
  },
});

route("GET", "/api/session", {
  staff: true,
  handle: async (ctx) => ({ status: 200, body: sessionJson(ctx.member) }),
});

route("DELETE", "/api/session", {
  handle: async (ctx) => {
    await endSession(ctx.req);
    return { status: 204, headers: { "Set-Cookie": sessionCookie("", 0) } };
  },
});

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  yacht_slug: string | null;
}

function memberJson(m: MemberRow): Json {
  return { id: m.id, name: m.name, email: m.email, role: m.role, yachtSlug: m.role === "crew_member" ? m.yacht_slug : null };
}

const MEMBER_SELECT = `SELECT m.id, m.name, m.email, m.role, y.slug AS yacht_slug FROM members m LEFT JOIN yachts y ON y.id = m.yacht_id`;

async function memberInWorkspace(workspace: string, id: string): Promise<MemberRow> {
  const found = /^[0-9a-f-]{36}$/i.test(id)
    ? await one<MemberRow>(pool, `${MEMBER_SELECT} WHERE m.id = $1 AND m.workspace_slug = $2 AND m.removed_at IS NULL`, [id, workspace])
    : undefined;
  if (!found) throw notFound();
  return found;
}

route("GET", "/api/w/:ws/members", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow([]);
    const list = await rows<MemberRow>(pool, `${MEMBER_SELECT} WHERE m.workspace_slug = $1 AND m.removed_at IS NULL ORDER BY m.created_at, m.name`, [ctx.params.ws]);
    return { status: 200, body: { members: list.map(memberJson) } };
  },
});

/** A crew member's yacht: required for crew, ignored for every other role. */
async function crewYacht(fields: Fields, workspace: string, role: Role | null, slug: unknown): Promise<string | null> {
  if (role !== "crew_member") return null;
  if (typeof slug !== "string" || slug === "") {
    fields.fail("yachtSlug", FIELD.crewYacht);
    return null;
  }
  const yacht = await yachtBySlug(pool, workspace, slug);
  if (!yacht) throw notFound();
  return yacht.id;
}

route("POST", "/api/w/:ws/members", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow([]);
    const body = asBody(await ctx.json());
    const fields = new Fields();
    const yachtId = await crewYacht(fields, ctx.params.ws, ROLES.includes(body.role as Role) ? (body.role as Role) : null, body.yachtSlug);
    const name = fields.text("name", body.name, 80);
    const email = fields.email("email", body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) fields.fail("password", FIELD.required);
    else if ([...password].length < 10) fields.fail("password", FIELD.password);
    const role = fields.option("role", body.role, ROLES);
    if (email && (await memberByEmail(pool, email))) throw conflict("email_in_use");
    fields.check();
    const id = randomUUID();
    try {
      await pool.query("INSERT INTO members (id, workspace_slug, name, email, password_hash, role, yacht_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, ctx.params.ws, name, email, await hashPassword(password), role, yachtId]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw conflict("email_in_use");
      throw error;
    }
    return { status: 201, body: { member: memberJson(await memberInWorkspace(ctx.params.ws, id)) } };
  },
});

route("PATCH", "/api/w/:ws/members/:id", {
  staff: true,
  handle: async (ctx) => {
    const target = await memberInWorkspace(ctx.params.ws, ctx.params.id);
    ctx.allow([]);
    const body = asBody(await ctx.json());
    if (target.id === ctx.member.id) throw conflict("cannot_change_self");
    const fields = new Fields();
    const role = fields.option("role", body.role, ROLES);
    const yachtId = await crewYacht(fields, ctx.params.ws, role, body.yachtSlug);
    fields.check();
    await pool.query("UPDATE members SET role = $2, yacht_id = $3 WHERE id = $1", [target.id, role, yachtId]);
    return { status: 200, body: { member: memberJson(await memberInWorkspace(ctx.params.ws, target.id)) } };
  },
});

route("DELETE", "/api/w/:ws/members/:id", {
  staff: true,
  handle: async (ctx) => {
    const target = await memberInWorkspace(ctx.params.ws, ctx.params.id);
    ctx.allow([]);
    if (target.id === ctx.member.id) throw conflict("cannot_remove_self");
    await transaction(async (db) => {
      await db.query("UPDATE members SET removed_at = now() WHERE id = $1", [target.id]);
      await db.query("UPDATE sessions SET ended_at = coalesce(ended_at, now()) WHERE member_id = $1", [target.id]);
    });
    return { status: 204 };
  },
});
