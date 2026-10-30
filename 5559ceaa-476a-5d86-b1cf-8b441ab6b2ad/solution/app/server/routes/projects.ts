import { randomUUID } from "node:crypto";
import { many, one, pool, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { audit } from "../files.js";
import { noContent, ok, type Reply, route } from "../http.js";
import { broadcast, broadcastPresence, onlineUsers, revoke } from "../hub.js";
import { idempotentRequest, remember, replayed, requireKey } from "../idempotency.js";
import { inviteMessage } from "../mail.js";
import { attempt, enqueue } from "../outbox.js";
import { handBack } from "../rules.js";
import {
  iso,
  memberRows,
  mentorOnly,
  projectRole,
  SESSION_COLUMNS,
  type SessionRow,
  sessionView,
} from "../views.js";
import { ERASED_NAME, issueSignInToken, normaliseEmail, validEmail } from "./auth.js";

const GROUP_SEATS = 6;

export function titleOf(raw: unknown, field: string): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  const length = [...title].length;
  if (length < 1 || length > 80) throw invalid({ [field]: "Use 1 to 80 characters." });
  return title;
}

route("GET", "/api/projects", async (ctx) => {
  const projects = await many(
    pool,
    `SELECT p.id, p.title, p.kind, m.role,
       (SELECT count(*)::int FROM memberships s WHERE s.project_id = p.id AND s.role = 'student') AS student_count
     FROM memberships m JOIN projects p ON p.id = m.project_id WHERE m.user_id = $1 ORDER BY p.created_at DESC, p.id`,
    [ctx.user.id],
  );
  return ok({ projects });
});

route("POST", "/api/projects", async (ctx) => {
  if (ctx.user.kind !== "mentor") throw new ApiError("forbidden");
  const body = ctx.json();
  const title = titleOf(body.title, "title");
  if (body.kind !== "one_to_one" && body.kind !== "group") throw invalid({ kind: "Choose one-to-one or group." });
  const project = { id: randomUUID(), title, kind: body.kind };
  await tx(async (db) => {
    await db.query("INSERT INTO projects (id, title, kind, owner_id) VALUES ($1, $2, $3, $4)", [
      project.id,
      project.title,
      project.kind,
      ctx.user.id,
    ]);
    await db.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, 'mentor')", [project.id, ctx.user.id]);
  });
  return ok({ project }, 201);
});

route("GET", "/api/projects/:project_id", async (ctx) => {
  const id = ctx.params.project_id!;
  await projectRole(pool, id, ctx.user.id);
  const project = await one<{ id: string; title: string; kind: string; owner_id: string; owner_name: string }>(
    pool,
    "SELECT p.id, p.title, p.kind, p.owner_id, u.name AS owner_name FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1",
    [id],
  );
  const online = onlineUsers(id);
  const members = (await memberRows(pool, id)).map((m) => ({ ...m, online: online.has(m.user_id) }));
  const sessions = await many<SessionRow>(pool, `SELECT ${SESSION_COLUMNS} FROM sessions WHERE project_id = $1 ORDER BY seq`, [id]);
  return ok({
    project: {
      id: project!.id,
      title: project!.title,
      kind: project!.kind,
      owner: { id: project!.owner_id, name: project!.owner_name },
      members,
      sessions: sessions.map(sessionView),
    },
  });
});

route("POST", "/api/projects/:project_id/invites", async (ctx) => {
  const projectId = ctx.params.project_id!;
  await mentorOnly(pool, projectId, ctx.user.id);
  const request = idempotentRequest(ctx);
  const body = ctx.json();
  const outcome = await tx(async (db) => {
    const project = (await one<{ title: string; kind: string; owner_id: string }>(
      db,
      "SELECT title, kind, owner_id FROM projects WHERE id = $1 FOR UPDATE",
      [projectId],
    ))!;
    const replay = await replayed(db, ctx.user.id, request);
    if (replay) return { reply: replay };
    const email = normaliseEmail(body.email);
    const existing = await one<{ id: string; name: string }>(db, "SELECT id, name FROM users WHERE email = $1", [email]);
    const seat = existing
      ? await one<{ role: string }>(db, "SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2", [projectId, existing.id])
      : undefined;
    if (!seat) {
      const students = (await one<{ n: number }>(
        db,
        "SELECT count(*)::int AS n FROM memberships WHERE project_id = $1 AND role = 'student'",
        [projectId],
      ))!.n;
      if (project.kind === "one_to_one" && students >= 1) throw new ApiError("seat_taken");
      if (project.kind === "group" && students >= GROUP_SEATS) throw new ApiError("group_full");
    }
    requireKey(request);
    const fields: Record<string, string> = {};
    if (!validEmail(email)) fields.email = "Enter an email address like name@example.com.";
    else if (seat?.role === "mentor") fields.email = "That address already runs this project.";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if ([...name].length < 1 || [...name].length > 80) fields.name = "Enter the learner's name (1 to 80 characters).";
    if (Object.keys(fields).length) throw invalid(fields);
    const learner = existing ?? { id: randomUUID(), name };
    if (!existing) {
      await db.query("INSERT INTO users (id, email, name, kind) VALUES ($1, $2, $3, 'learner')", [learner.id, email, name]);
    }
    await db.query(
      `INSERT INTO memberships (project_id, user_id, role, email_status) VALUES ($1, $2, 'student', 'queued')
       ON CONFLICT (project_id, user_id) DO UPDATE SET email_status = 'queued'`,
      [projectId, learner.id],
    );
    const inviteId = randomUUID();
    await db.query("INSERT INTO invites (id, project_id, user_id, email, name, email_status) VALUES ($1, $2, $3, $4, $5, 'queued')", [
      inviteId,
      projectId,
      learner.id,
      email,
      name,
    ]);
    const token = await issueSignInToken(db, email, learner.id, projectId);
    const message = await enqueue(db, inviteMessage(email, ctx.user.name, project.title, token), { invite_id: inviteId });
    const reply = (status: "sent" | "queued"): Reply =>
      ok(
        {
          invite: { id: inviteId, email, name, email_status: status },
          member: {
            user_id: learner.id,
            name: learner.name,
            role: "student",
            online: onlineUsers(projectId).has(learner.id),
            email_status: status,
          },
        },
        201,
      );
    const final = reply((await attempt(db, message, 0)) ? "sent" : "queued");
    await remember(db, ctx.user.id, request, final, learner.id);
    return { reply: final };
  });
  void broadcastPresence(projectId).catch(() => undefined);
  return outcome.reply;
});

route("DELETE", "/api/projects/:project_id/members/:user_id", async (ctx) => {
  const projectId = ctx.params.project_id!;
  const userId = ctx.params.user_id!;
  await mentorOnly(pool, projectId, ctx.user.id);
  const session = await tx(async (db) => {
    const project = (await one<{ owner_id: string }>(db, "SELECT owner_id FROM projects WHERE id = $1 FOR UPDATE", [projectId]))!;
    const target = await one<{ name: string }>(
      db,
      "SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.user_id = $2",
      [projectId, userId],
    );
    if (!target) throw new ApiError("not_found");
    if (userId === project.owner_id) throw new ApiError("forbidden");
    await db.query("DELETE FROM memberships WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
    await audit(db, projectId, ctx.user.id, "member_removed", { user_id: userId, name: target.name });
    return handBack(db, projectId, userId);
  });
  revoke(projectId, userId);
  if (session) broadcast(projectId, { type: "session", session: sessionView(session) });
  await broadcastPresence(projectId);
  return noContent();
});

route("GET", "/api/projects/:project_id/audit", async (ctx) => {
  const projectId = ctx.params.project_id!;
  await mentorOnly(pool, projectId, ctx.user.id);
  const rows = await many<{ id: string; type: string; actor_id: string | null; actor_name: string | null; subject: unknown; at: Date }>(
    pool,
    `SELECT a.id, a.type, a.actor_id, u.name AS actor_name, a.subject, a.at FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.project_id = $1 ORDER BY a.at DESC, a.seq DESC`,
    [projectId],
  );
  return ok({
    events: rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor_id ? { id: r.actor_id, name: r.actor_name } : { id: null, name: ERASED_NAME },
      subject: r.subject,
      at: iso(r.at),
    })),
  });
});
