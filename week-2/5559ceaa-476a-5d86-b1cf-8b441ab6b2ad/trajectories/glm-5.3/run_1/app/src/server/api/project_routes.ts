import { Router, type RouteCtx, json } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { membership, requireProjectView, requireMentor } from "./helpers.js";
import { checkIdempotency, storeIdempotency } from "./idempotency.js";

import type { Services } from "../services.js";
import { membersOf } from "./members.js";

export function registerProjectRoutes(router: Router, svc: Services): void {
  router.add("GET", "/api/projects", async (ctx: RouteCtx) => {
    if (!ctx.user) throw new ApiError("unauthenticated", "You need to sign in.");
    const r = await svc.pool.query(
      `SELECT p.id, p.title, p.kind, m.role,
        (SELECT count(*) FROM memberships m2 WHERE m2.project_id = p.id AND m2.role = 'student') AS student_count
       FROM projects p JOIN memberships m ON m.project_id = p.id
       WHERE m.user_id = $1 ORDER BY p.created_at ASC`,
      [ctx.user.id],
    );
    return json(200, {
      projects: r.rows.map((row: { id: string; title: string; kind: string; role: string; student_count: string }) => ({
        id: row.id, title: row.title, kind: row.kind, role: row.role, student_count: Number(row.student_count),
      })),
    });
  });

  router.add("POST", "/api/projects", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    if (user.kind === "learner") throw new ApiError("forbidden", "Learners cannot create projects.");
    const body = z.object({ title: z.string({ min: 1, max: 80 }), kind: z.string() }).parse(ctx.body);
    const kind = body.kind;
    if (kind !== "one_to_one" && kind !== "group") {
      throw new ApiError("validation", "kind must be one_to_one or group", { fields: { kind: "must be one_to_one or group" } });
    }
    const title = (body.title ?? "").trim();
    if (title.length < 1 || title.length > 80) {
      throw new ApiError("validation", "title must be 1 to 80 characters", { fields: { title: "must be 1 to 80 characters" } });
    }
    const id = crypto.randomUUID();
    const client = await svc.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO projects (id, title, kind, owner_id) VALUES ($1,$2,$3,$4)`, [id, title, kind, user.id]);
      await client.query(`INSERT INTO memberships (project_id, user_id, role) VALUES ($1,$2,'mentor')`, [id, user.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return json(201, { project: { id, title, kind } });
  });

  router.add("GET", "/api/projects/<project_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const project = await requireProjectView(svc.pool, projectId, user);
    const members = await membersOf(svc.pool, projectId);
    const sessions = await svc.pool.query(
      `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions
       WHERE project_id = $1 ORDER BY created_at ASC`,
      [projectId],
    );
    return json(200, {
      project: {
        id: project.id,
        title: project.title,
        kind: project.kind,
        owner: { id: project.owner_id, name: (await svc.userName(project.owner_id)) ?? "" },
        members,
        sessions: sessions.rows.map((s: Record<string, unknown>) => sessionOutRow(s)),
      },
    });
  });

  router.add("POST", "/api/projects/<project_id>/invites", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const project = await requireMentor(svc.pool, projectId, user);
    const key = headerKey(ctx.req.headers["idempotency-key"]);
    const replay = await checkIdempotency(svc.pool, user.id, key, ctx.body);
    if (replay) return json(replay.status, replay.body);
    const body = z.object({ email: z.string({ min: 1 }), name: z.string({ min: 1, max: 80 }) }).parse(ctx.body);
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError("validation", "Invalid email.", { fields: { email: "Enter an email address like name@example.com." } });
    }
    const name = (body.name ?? "").trim();
    if (name.length < 1 || name.length > 80) {
      throw new ApiError("validation", "Invalid name.", { fields: { name: "Enter the learner's name (1 to 80 characters)." } });
    }
    const result = await svc.invites.createInvite(project, user, email, name);
    const responseBody = { invite: result.invite, member: result.member };
    await storeIdempotency(svc.pool, user.id, key as string, ctx.body, 201, responseBody);
    return json(201, responseBody);
  });

  router.add("DELETE", "/api/projects/<project_id>/members/<user_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const targetId = ctx.params["user_id"] as string;
    const project = await requireMentor(svc.pool, projectId, user);
    if (targetId === project.owner_id) throw new ApiError("forbidden", "The owner cannot be removed.");
    const role = await membership(svc.pool, projectId, targetId);
    if (role === null) throw new ApiError("not_found", "No such member.");
    await svc.removal.removeMember(project, targetId, user);
    return json(204);
  });

  router.add("GET", "/api/projects/<project_id>/audit", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    const r = await svc.pool.query(
      `SELECT id, type, actor_id, actor_name, subject, at FROM audit_events
       WHERE project_id = $1 ORDER BY at DESC`,
      [projectId],
    );
    return json(200, {
      events: r.rows.map((e: { id: string; type: string; actor_id: string | null; actor_name: string; subject: string; at: Date }) => ({
        id: e.id,
        type: e.type,
        actor: { id: e.actor_id, name: e.actor_name },
        subject: e.subject,
        at: e.at.toISOString(),
      })),
    });
  });
}

function headerKey(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export function sessionOutRow(s: Record<string, unknown>): Record<string, unknown> {
  return {
    id: s.id,
    project_id: s.project_id,
    title: s.title,
    state: s.state,
    scheduled_for: (s.scheduled_for as Date).toISOString(),
    driver_id: s.driver_id,
    version: s.version,
  };
}
