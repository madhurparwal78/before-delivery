// Sign-in, the current session, sign-out, the workspace, and the members the compliance officer manages.
import { randomUUID } from "node:crypto";
import {
  allow, checkCredentials, CLEARED_COOKIE, currentMember, digest, hashPassword, isRole, ROLES, SESSION_COOKIE,
  sessionCookie, staff, startSession, type Member,
} from "../auth.js";
import { one, pool, rows } from "../db.js";
import { ApiError, FieldCheck, refuse } from "../errors.js";
import { objectBody, type Ctx, type Router } from "../http.js";
import { codePoints } from "../names.js";
import { isUuid } from "../cases/transitions.js";
import { workspaceBySlug } from "../workspaces.js";
import { businessDate, isoInstant } from "../../shared/format.js";

function sessionBody(member: Member) {
  const workspace = workspaceBySlug(member.workspaceSlug)!;
  return {
    member: { id: member.id, name: member.name, email: member.email, role: member.role },
    workspace: { slug: workspace.slug, name: workspace.name },
    home: `/w/${workspace.slug}/${member.role === "finance_lead" ? "months" : "cases"}`,
  };
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: Date;
}

const memberBody = (m: MemberRow) => ({ id: m.id, name: m.name, email: m.email, role: m.role, createdAt: isoInstant(m.created_at.getTime()) });

async function findMember(ctx: Ctx, slug: string): Promise<MemberRow> {
  const id = ctx.params.memberId;
  const found = isUuid(id)
    ? await one<MemberRow>(pool, "SELECT * FROM members WHERE id = $1 AND workspace_slug = $2 AND removed_at IS NULL", [id, slug])
    : null;
  if (!found) throw refuse.notFound();
  return found;
}

const ownMembership = () => refuse.conflict("own_membership", "You can't change or remove your own membership.");

export function registerSession(router: Router): void {
  router.add("POST", "/api/session", async (ctx) => {
    const body = objectBody(ctx.json());
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const member = await checkCredentials(email, password);
    if (!member) throw new ApiError(401, "sign_in_failed", "Email or password is incorrect.");
    const token = await startSession(member);
    return { status: 200, json: sessionBody(member), headers: { "Set-Cookie": sessionCookie(token) } };
  });

  router.add("GET", "/api/session", async (ctx) => ({ status: 200, json: sessionBody(await currentMember(ctx)) }));

  router.add("DELETE", "/api/session", async (ctx) => {
    await currentMember(ctx);
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [digest(ctx.cookie(SESSION_COOKIE) ?? "")]);
    return { status: 204, headers: { "Set-Cookie": CLEARED_COOKIE } };
  });

  router.add("GET", "/api/w/:slug", async (ctx) => {
    const { workspace: w } = await staff(ctx);
    const now = Date.now();
    return {
      status: 200,
      json: {
        workspace: {
          slug: w.slug, name: w.name, legalName: w.legalName, lei: w.lei, jurisdictionCode: w.jurisdictionCode,
          timeZone: w.timeZone, city: w.city, currency: w.currency, confirmationLimitCents: w.confirmationLimitCents,
          today: businessDate(w.timeZone, now), now: isoInstant(now),
        },
      },
    };
  });

  router.add("GET", "/api/w/:slug/members", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const found = await rows<MemberRow>(pool,
      "SELECT * FROM members WHERE workspace_slug = $1 AND removed_at IS NULL ORDER BY created_at, email", [who.workspace.slug]);
    return { status: 200, json: { members: found.map(memberBody) } };
  });

  router.add("GET", "/api/w/:slug/members/:memberId", async (ctx) => {
    const who = await staff(ctx);
    const member = await findMember(ctx, who.workspace.slug);
    allow(who, "compliance_officer");
    return { status: 200, json: { member: memberBody(member) } };
  });

  router.add("POST", "/api/w/:slug/members", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    const check = new FieldCheck();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (name === "" || codePoints(name) > 120) check.fail("name", "Enter a name of up to 120 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) check.fail("email", "Enter an email address.");
    if (!isRole(body.role)) check.fail("role", "Choose a role.");
    if (codePoints(password) < 12) check.fail("password", "Use a starting password of at least 12 characters.");
    if (email && await one(pool, "SELECT 1 FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email])) {
      throw refuse.conflict("email_taken", "This email already belongs to a member.");
    }
    check.throwIfAny();
    const created = await one<MemberRow>(pool,
      `INSERT INTO members (id, workspace_slug, name, email, role, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), who.workspace.slug, name, email, body.role, await hashPassword(password)]);
    if (!created) throw refuse.conflict("email_taken", "This email already belongs to a member.");
    return { status: 201, json: { member: memberBody(created) } };
  });

  router.add("PATCH", "/api/w/:slug/members/:memberId", async (ctx) => {
    const who = await staff(ctx);
    const member = await findMember(ctx, who.workspace.slug);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    if (member.id === who.member.id) throw ownMembership();
    if (!isRole(body.role)) throw refuse.invalid({ role: `Choose one of ${ROLES.join(", ")}.` });
    const updated = await one<MemberRow>(pool, "UPDATE members SET role = $2 WHERE id = $1 RETURNING *", [member.id, body.role]);
    return { status: 200, json: { member: memberBody(updated!) } };
  });

  router.add("DELETE", "/api/w/:slug/members/:memberId", async (ctx) => {
    const who = await staff(ctx);
    const member = await findMember(ctx, who.workspace.slug);
    allow(who, "compliance_officer");
    if (member.id === who.member.id) throw ownMembership();
    await pool.query("UPDATE members SET removed_at = now() WHERE id = $1", [member.id]);
    return { status: 204 };
  });
}
