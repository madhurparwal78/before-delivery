// Sign-in, profile, members and invitations, the plan and the usage figures.
import { randomBytes } from "node:crypto";
import type { Plan } from "../../shared/billing";
import { costCents, isPlan, PLANS } from "../../shared/billing";
import { ROLES, type Member, type Role, type User } from "../../shared/types";
import { landing } from "../../shared/permissions";
import {
  authenticate,
  clearedCookie,
  cookieToken,
  hashPassword,
  isUuid,
  loadCaller,
  newToken,
  permit,
  refuseForeignOrigin,
  sessionCookie,
  sha256,
  verifyPassword,
  type Caller,
} from "../access";
import { ApiError, invalid, jsonFields, notFound, sendJson, type Request, type Router } from "../http";
import { isUniqueViolation, one, pool, rows, tx } from "../db";
import { billingReachable, resolvePlanChange } from "../billing";
import { idempotent } from "../idempotency";
import { period } from "../quota";
import { clean, email as emailOf, limited } from "../../shared/text";

const userOf = (caller: Caller): User => ({ id: caller.id, name: caller.name, email: caller.email, role: caller.role, org_id: caller.org_id });
const PASSWORD_ERROR = "Use at least 12 characters.";

async function startSession(request: Request, memberId: string, status: number): Promise<void> {
  const token = newToken();
  await pool.query("INSERT INTO auth_sessions (token_hash, member_id) VALUES ($1, $2)", [sha256(token), memberId]);
  const caller = (await loadCaller(memberId))!;
  sendJson(request.res, status, { user: userOf(caller), landing: landing(caller.role) }, { "set-cookie": sessionCookie(token) });
}

async function memberObjects(orgId: string, memberId?: string): Promise<Member[]> {
  const found = await rows<Omit<Member, "joined_at"> & { joined_at: Date }>(
    `SELECT m.id, m.name, m.email, m.role, m.joined_at,
            COALESCE(array_agg(mp.project_id ORDER BY p.created_at) FILTER (WHERE mp.project_id IS NOT NULL), '{}') AS project_ids
       FROM members m LEFT JOIN member_projects mp ON mp.member_id = m.id LEFT JOIN projects p ON p.id = mp.project_id
      WHERE m.org_id = $1 AND m.removed_at IS NULL ${memberId ? "AND m.id = $2" : ""}
      GROUP BY m.id ORDER BY m.joined_at, m.name`,
    memberId ? [orgId, memberId] : [orgId],
  );
  return found.map((m) => ({ ...m, joined_at: m.joined_at.toISOString() }));
}

/** Project ids from a body: every one must be a project of the organisation, else 404. */
async function orgProjectIds(orgId: string, value: unknown): Promise<string[] | null> {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((id): id is string => typeof id === "string");
  if (strings.length !== value.length) return null;
  const ids = [...new Set(strings)];
  if (!ids.every(isUuid)) throw notFound();
  const found = await rows<{ id: string }>("SELECT id FROM projects WHERE org_id = $1 AND id = ANY($2::uuid[])", [orgId, ids]);
  if (found.length !== ids.length) throw notFound();
  return ids;
}

const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

async function currentPlan(caller: Caller): Promise<{ plan: Plan; billing_reachable: boolean; change: object | null }> {
  const org = (await one<{ plan: Plan }>("SELECT plan FROM orgs WHERE id = $1", [caller.org_id]))!;
  const change = await one<{ id: string; target: Plan; state: string; requested_at: Date; decided_at: Date | null }>(
    "SELECT id, target, state, requested_at, decided_at FROM plan_changes WHERE org_id = $1 ORDER BY requested_at DESC LIMIT 1",
    [caller.org_id],
  );
  return {
    plan: org.plan,
    billing_reachable: billingReachable(),
    change: change
      ? { id: change.id, target: change.target, state: change.state, requested_at: change.requested_at.toISOString(), decided_at: change.decided_at?.toISOString() ?? null }
      : null,
  };
}

export function registerOrg(router: Router): void {
  router.add("POST", "/api/auth/sign-in", async (request) => {
    const body = jsonFields(request);
    const member = await one<{ id: string; password_hash: string }>(
      "SELECT id, password_hash FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL",
      [clean(body.email)],
    );
    const password = typeof body.password === "string" ? body.password : "";
    if (!member || !(await verifyPassword(password, member.password_hash))) {
      throw new ApiError(401, "invalid_credentials", "That email and password don't match.");
    }
    refuseForeignOrigin(request.req);
    await startSession(request, member.id, 200);
  });

  router.add("POST", "/api/auth/sign-out", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "profile");
    const token = cookieToken(request.req);
    if (token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [sha256(token)]);
    request.res.writeHead(204, { "set-cookie": clearedCookie() });
    request.res.end();
  });

  router.add("GET", "/api/me", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "profile");
    const org = (await one<{ id: string; name: string; slug: string; plan: Plan }>("SELECT id, name, slug, plan FROM orgs WHERE id = $1", [caller.org_id]))!;
    sendJson(request.res, 200, { user: userOf(caller), org, project_ids: caller.projectIds });
  });

  router.add("GET", "/api/org/members", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "admin");
    const invitations = await rows<{ id: string; name: string; email: string; role: Role; project_ids: string[] }>(
      "SELECT id, name, email, role, project_ids FROM invitations WHERE org_id = $1 AND used_at IS NULL ORDER BY created_at",
      [caller.org_id],
    );
    sendJson(request.res, 200, { members: await memberObjects(caller.org_id), invitations: invitations.map((i) => ({ ...i, used: false })) });
  });

  router.add("POST", "/api/org/invitations", async (request) => {
    const caller = await authenticate(request.req);
    const body = jsonFields(request);
    const projectIds = await orgProjectIds(caller.org_id, body.project_ids ?? []);
    permit(caller, "admin");
    const name = limited(body.name, 1, 100);
    const email = emailOf(body.email);
    if (email !== null) {
      const taken = await one(
        "SELECT 1 AS taken FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL UNION ALL SELECT 1 FROM invitations WHERE lower(email) = lower($1) AND used_at IS NULL",
        [email],
      );
      if (taken) throw new ApiError(409, "email_taken", "That email already belongs to a member or an open invitation.");
    }
    const fields: Record<string, string> = {};
    if (name === null) fields.name = "Enter a name of up to 100 characters.";
    if (email === null) fields.email = "Enter an email address of up to 200 characters.";
    if (!isRole(body.role)) fields.role = "Choose a role.";
    if (!projectIds) fields.project_ids = "Choose projects from the list.";
    if (Object.keys(fields).length) throw invalid(fields);
    const token = randomBytes(24).toString("base64url");
    try {
      const created = (await one<{ id: string }>(
        "INSERT INTO invitations (org_id, token_hash, name, email, role, project_ids) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [caller.org_id, sha256(token), name, email, body.role, projectIds],
      ))!;
      sendJson(request.res, 201, { id: created.id, invite_url: `/join/${token}` });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "email_taken", "That email already belongs to a member or an open invitation.");
      throw error;
    }
  });

  router.add("POST", "/api/invitations/:token/accept", async (request) => {
    const invitation = await one<{ id: string; org_id: string; name: string; email: string; role: Role; project_ids: string[]; used_at: Date | null }>(
      "SELECT id, org_id, name, email, role, project_ids, used_at FROM invitations WHERE token_hash = $1",
      [sha256(request.params.token)],
    );
    if (!invitation) throw notFound();
    refuseForeignOrigin(request.req);
    if (invitation.used_at) throw new ApiError(410, "invitation_used", "This invitation has already been used.");
    const body = jsonFields(request);
    const password = typeof body.password === "string" ? body.password : "";
    if ([...password].length < 12) throw invalid({ password: PASSWORD_ERROR });
    const passwordHash = await hashPassword(password);
    const memberId = await tx(async (db) => {
      const claimed = await db.query("UPDATE invitations SET used_at = now() WHERE id = $1 AND used_at IS NULL", [invitation.id]);
      if (!claimed.rowCount) throw new ApiError(410, "invitation_used", "This invitation has already been used.");
      const member = await db
        .query<{ id: string }>("INSERT INTO members (org_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
          invitation.org_id,
          invitation.name,
          invitation.email,
          passwordHash,
          invitation.role,
        ])
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? new ApiError(409, "email_taken", "That email already belongs to a member.") : error;
        });
      const id = member.rows[0].id;
      await db.query("INSERT INTO member_projects (member_id, project_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING", [id, invitation.project_ids]);
      return id;
    });
    await startSession(request, memberId, 201);
  });

  router.add("PATCH", "/api/org/members/:member", async (request) => {
    const caller = await authenticate(request.req);
    const target = isUuid(request.params.member)
      ? await one<{ id: string }>("SELECT id FROM members WHERE id = $1 AND org_id = $2 AND removed_at IS NULL", [request.params.member, caller.org_id])
      : undefined;
    if (!target) throw notFound();
    const body = jsonFields(request);
    const projectIds = body.project_ids === undefined ? undefined : await orgProjectIds(caller.org_id, body.project_ids);
    permit(caller, "admin");
    if (target.id === caller.id) throw new ApiError(409, "self_change", "You can't change or remove your own membership.");
    const fields: Record<string, string> = {};
    if (body.role !== undefined && !isRole(body.role)) fields.role = "Choose a role.";
    if (projectIds === null) fields.project_ids = "Choose projects from the list.";
    if (body.role === undefined && body.project_ids === undefined) fields.role = "Choose a role.";
    if (Object.keys(fields).length) throw invalid(fields);
    await tx(async (db) => {
      if (isRole(body.role)) await db.query("UPDATE members SET role = $2 WHERE id = $1", [target.id, body.role]);
      if (projectIds) {
        await db.query("DELETE FROM member_projects WHERE member_id = $1", [target.id]);
        await db.query("INSERT INTO member_projects (member_id, project_id) SELECT $1, unnest($2::uuid[])", [target.id, projectIds]);
      }
    });
    sendJson(request.res, 200, { member: (await memberObjects(caller.org_id, target.id))[0] });
  });

  router.add("DELETE", "/api/org/members/:member", async (request) => {
    const caller = await authenticate(request.req);
    const target = isUuid(request.params.member)
      ? await one<{ id: string }>("SELECT id FROM members WHERE id = $1 AND org_id = $2 AND removed_at IS NULL", [request.params.member, caller.org_id])
      : undefined;
    if (!target) throw notFound();
    permit(caller, "admin");
    if (target.id === caller.id) throw new ApiError(409, "self_change", "You can't change or remove your own membership.");
    await tx(async (db) => {
      await db.query("UPDATE members SET removed_at = now() WHERE id = $1", [target.id]);
      await db.query("DELETE FROM auth_sessions WHERE member_id = $1", [target.id]);
      await db.query("DELETE FROM member_projects WHERE member_id = $1", [target.id]);
    });
    request.res.writeHead(204);
    request.res.end();
  });

  router.add("GET", "/api/org/plan", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "admin");
    sendJson(request.res, 200, await currentPlan(caller));
  });

  router.add("POST", "/api/org/plan-changes", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "admin");
    const body = jsonFields(request);
    const result = await idempotent(caller, request, { route: "plan-change", plan: body.plan ?? null }, async () => {
      const org = (await one<{ plan: Plan; kb_subscription_id: string | null }>("SELECT plan, kb_subscription_id FROM orgs WHERE id = $1", [caller.org_id]))!;
      if (body.plan === org.plan) throw new ApiError(409, "plan_unchanged", "The organisation is already on that plan.");
      const pending = await one("SELECT 1 AS pending FROM plan_changes WHERE org_id = $1 AND state = 'requested'", [caller.org_id]);
      if (pending) throw new ApiError(409, "change_pending", "A plan change is already waiting for billing.");
      if (!isPlan(body.plan)) throw invalid({ plan: "Choose Pilot or Scale." });
      if (!billingReachable() || !org.kb_subscription_id) throw new ApiError(503, "billing_unavailable", "Billing is unreachable, so your plan hasn't changed. Try again in a minute.");
      try {
        const change = (await one<{ id: string; target: Plan; state: string; requested_at: Date }>(
          "INSERT INTO plan_changes (org_id, target, state) VALUES ($1, $2, 'requested') RETURNING id, target, state, requested_at",
          [caller.org_id, body.plan],
        ))!;
        return { status: 202, body: { change: { id: change.id, target: change.target, state: change.state, requested_at: change.requested_at.toISOString(), decided_at: null } } };
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, "change_pending", "A plan change is already waiting for billing.");
        throw error;
      }
    });
    sendJson(request.res, result.status, result.body);
    const change = (result.body as { change?: { id: string; state: string } }).change;
    if (change?.state === "requested") void resolvePlanChange(change.id).catch(() => undefined);
  });

  router.add("GET", "/api/usage", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "usage.read");
    const { start, resets } = period();
    const projects = await rows<{ id: string; name: string }>("SELECT id, name FROM projects WHERE org_id = $1 ORDER BY created_at, name", [caller.org_id]);
    const sums = await rows<{ project_id: string; plan: Plan; seconds: number; sessions: number; pending: number }>(
      `SELECT s.project_id, s.plan, SUM(s.billable_seconds)::bigint AS seconds, COUNT(*)::int AS sessions,
              COUNT(*) FILTER (WHERE s.billing_state = 'pending')::int AS pending
         FROM sessions s JOIN projects p ON p.id = s.project_id
        WHERE p.org_id = $1 AND s.billing_state IN ('pending', 'confirmed') AND s.ended_at >= $2 AND s.ended_at < $3
        GROUP BY s.project_id, s.plan`,
      [caller.org_id, start, resets],
    );
    const usage = projects.map((project) => {
      const mine = sums.filter((row) => row.project_id === project.id);
      const byPlan = PLANS.map((plan) => {
        const seconds = mine.find((row) => row.plan === plan)?.seconds ?? 0;
        return { plan, billable_seconds: seconds, cost_cents: costCents(plan, seconds) };
      });
      const pending = mine.reduce((n, row) => n + row.pending, 0);
      return {
        project_id: project.id,
        name: project.name,
        sessions: mine.reduce((n, row) => n + row.sessions, 0),
        billable_seconds: byPlan.reduce((n, row) => n + row.billable_seconds, 0),
        cost_cents: byPlan.reduce((n, row) => n + row.cost_cents, 0),
        billing_state: pending > 0 ? "pending" : "confirmed",
        pending_sessions: pending,
        by_plan: byPlan,
      };
    });
    sendJson(request.res, 200, {
      month: start.toISOString().slice(0, 7),
      billing_reachable: billingReachable(),
      org_total_cents: usage.reduce((n, row) => n + row.cost_cents, 0),
      projects: usage,
    });
  });
}
