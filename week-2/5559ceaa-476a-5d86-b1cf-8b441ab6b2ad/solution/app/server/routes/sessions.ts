import { randomUUID } from "node:crypto";
import type pg from "pg";
import { one, pool, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { ok, route, UUID } from "../http.js";
import { mayPass } from "../../shared/rules.js";
import { broadcast } from "../hub.js";
import { checkBaton, lockProject, type SessionAction, transition } from "../rules.js";
import { mentorOnly, projectRole, type Role, SESSION_COLUMNS, type SessionRow, sessionView } from "../views.js";
import { titleOf } from "./projects.js";

async function sessionFor(db: pg.Pool | pg.PoolClient, sessionId: string, userId: string): Promise<{ session: SessionRow; role: Role }> {
  const session = await one<SessionRow>(db, `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1`, [sessionId]);
  if (!session) throw new ApiError("not_found");
  return { session, role: await projectRole(db, session.project_id, userId) };
}

/** Locks the project for update, so driver changes and writes never interleave, and re-reads the session. */
async function lockedSession(db: pg.PoolClient, session: SessionRow): Promise<SessionRow> {
  await lockProject(db, session.project_id);
  return (await one<SessionRow>(db, `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1`, [session.id]))!;
}

route("POST", "/api/projects/:project_id/sessions", async (ctx) => {
  const projectId = ctx.params.project_id!;
  await mentorOnly(pool, projectId, ctx.user.id);
  const body = ctx.json();
  const title = titleOf(body.title, "title");
  const when = typeof body.scheduled_for === "string" ? new Date(body.scheduled_for) : new Date(Number.NaN);
  if (Number.isNaN(when.getTime())) throw invalid({ scheduled_for: "Give the start time as an ISO date and time." });
  const session = await one<SessionRow>(
    pool,
    `INSERT INTO sessions (id, project_id, title, state, scheduled_for) VALUES ($1, $2, $3, 'scheduled', $4) RETURNING ${SESSION_COLUMNS}`,
    [randomUUID(), projectId, title, when],
  );
  broadcast(projectId, { type: "session", session: sessionView(session!) });
  return ok({ session: sessionView(session!) }, 201);
});

route("GET", "/api/sessions/:session_id", async (ctx) => {
  const { session } = await sessionFor(pool, ctx.params.session_id!, ctx.user.id);
  return ok({ session: sessionView(session) });
});

for (const action of ["start", "pause", "resume", "end"] as const satisfies readonly SessionAction[]) {
  route("POST", `/api/sessions/:session_id/${action}`, async (ctx) => {
    const found = await sessionFor(pool, ctx.params.session_id!, ctx.user.id);
    if (found.role !== "mentor") throw new ApiError("forbidden");
    const session = await tx(async (db) => {
      const current = await lockedSession(db, found.session);
      const state = transition(current.state, action);
      if (action === "start") {
        const running = await one<{ id: string }>(db, "SELECT id FROM sessions WHERE project_id = $1 AND state IN ('live', 'paused')", [
          current.project_id,
        ]);
        if (running) throw new ApiError("session_already_live", { session_id: running.id });
      }
      const owner = (await one<{ owner_id: string }>(db, "SELECT owner_id FROM projects WHERE id = $1", [current.project_id]))!;
      const driver = action === "start" ? owner.owner_id : action === "end" ? null : current.driver_id;
      const bump = driver === current.driver_id ? 0 : 1;
      return (await one<SessionRow>(
        db,
        `UPDATE sessions SET state = $2, driver_id = $3, version = version + $4, updated_at = now() WHERE id = $1 RETURNING ${SESSION_COLUMNS}`,
        [current.id, state, driver, bump],
      ))!;
    });
    broadcast(session.project_id, { type: "session", session: sessionView(session) });
    return ok({ session: sessionView(session) });
  });
}

async function changeDriver(db: pg.PoolClient, session: SessionRow, driver: string): Promise<SessionRow> {
  return (await one<SessionRow>(
    db,
    `UPDATE sessions SET driver_id = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING ${SESSION_COLUMNS}`,
    [session.id, driver],
  ))!;
}

route("POST", "/api/sessions/:session_id/baton/claim", async (ctx) => {
  const found = await sessionFor(pool, ctx.params.session_id!, ctx.user.id);
  const body = ctx.json();
  const session = await tx(async (db) => {
    const current = await lockedSession(db, found.session);
    await checkBaton(db, current, ctx.user.id, body.version);
    return changeDriver(db, current, ctx.user.id);
  });
  broadcast(session.project_id, { type: "session", session: sessionView(session) });
  return ok({ session: sessionView(session) });
});

route("POST", "/api/sessions/:session_id/baton/pass", async (ctx) => {
  const found = await sessionFor(pool, ctx.params.session_id!, ctx.user.id);
  const body = ctx.json();
  const target = typeof body.to_user_id === "string" ? body.to_user_id : "";
  const session = await tx(async (db) => {
    const current = await lockedSession(db, found.session);
    if (!mayPass(found.role, current.driver_id, ctx.user.id)) throw new ApiError("forbidden");
    const isMember = async (): Promise<boolean> =>
      UUID.test(target) &&
      !!(await one(db, "SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2", [current.project_id, target]));
    await checkBaton(db, current, target, body.version, isMember);
    return changeDriver(db, current, target);
  });
  broadcast(session.project_id, { type: "session", session: sessionView(session) });
  return ok({ session: sessionView(session) });
});
