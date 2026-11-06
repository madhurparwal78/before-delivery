import { Router, type RouteCtx, json } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { requireMentor, requireProjectView, sessionOut, sessionWithLock } from "./helpers.js";
import { transition } from "./rules.js";
import type { Services } from "../services.js";
import type { PoolClient } from "pg";

export function registerSessionRoutes(router: Router, svc: Services): void {
  router.add("POST", "/api/projects/<project_id>/sessions", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    const body = z.object({
      title: z.string({ min: 1, max: 80 }),
      scheduled_for: z.string({ min: 1 }),
    }).parse(ctx.body);
    const title = (body.title ?? "").trim();
    if (title.length < 1 || title.length > 80) {
      throw new ApiError("validation", "title must be 1 to 80 characters", { fields: { title: "must be 1 to 80 characters" } });
    }
    const when = new Date(body.scheduled_for ?? "");
    if (isNaN(when.getTime())) {
      throw new ApiError("validation", "scheduled_for must be an ISO time", { fields: { scheduled_for: "must be an ISO time" } });
    }
    const id = crypto.randomUUID();
    await svc.pool.query(
      `INSERT INTO sessions (id, project_id, title, state, scheduled_for, driver_id, version)
       VALUES ($1,$2,$3,'scheduled',$4,NULL,0)`,
      [id, projectId, title, when],
    );
    const s = await svc.pool.query(
      `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions WHERE id = $1`,
      [id],
    );
    const session = await publishSession(svc, projectId, s.rows[0] as Record<string, unknown>);
    return json(201, { session });
  });

  router.add("GET", "/api/sessions/<session_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const sessionId = ctx.params["session_id"] as string;
    const client = await svc.pool.connect();
    try {
      const s = await sessionRow(client, sessionId);
      await requireProjectView(svc.pool, s.project_id, user);
      return json(200, { session: sessionOut(s) });
    } finally {
      client.release();
    }
  });

  const transitions: Record<string, { to: string; driver: "mentor" | "keep" | "none" }> = {
    start: { to: "live", driver: "mentor" },
    pause: { to: "paused", driver: "keep" },
    resume: { to: "live", driver: "keep" },
    end: { to: "ended", driver: "none" },
  };

  for (const [action, t] of Object.entries(transitions)) {
    router.add("POST", `/api/sessions/<session_id>/${action}`, async (ctx: RouteCtx) => {
      const user = ctx.user;
      if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
      const sessionId = ctx.params["session_id"] as string;
      const client = await svc.pool.connect();
      let out: Record<string, unknown>;
      let projectId = "";
      try {
        await client.query("BEGIN");
        const s = await sessionWithLock(client, sessionId);
        projectId = s.project_id;
        await requireMentor(svc.pool, projectId, user);
        transition(s.state, t.to);
        if (t.to === "live") {
          const other = await client.query(
            `SELECT id FROM sessions WHERE project_id = $1 AND id <> $2 AND state IN ('live','paused')`,
            [projectId, sessionId],
          );
          if (other.rowCount && other.rowCount > 0) {
            const otherRow = other.rows[0] as { id: string };
            throw new ApiError("session_already_live", "Another session in this project is already running.", {
              session_id: otherRow.id,
            });
          }
        }
        let driverId: string | null = s.driver_id;
        let version = s.version;
        if (t.driver === "mentor") {
          driverId = await ownerId(client, projectId);
          version = version + 1;
        } else if (t.driver === "none") {
          driverId = null;
          version = version + 1;
        }
        await client.query(
          `UPDATE sessions SET state = $1, driver_id = $2, version = $3 WHERE id = $4`,
          [t.to, driverId, version, sessionId],
        );
        const fresh = await client.query(
          `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions WHERE id = $1`,
          [sessionId],
        );
        out = sessionOutRow(fresh.rows[0] as Record<string, unknown>);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      svc.bus.publish(projectId, { type: "session", session: out });
      return json(200, { session: out });
    });
  }

  router.add("POST", "/api/sessions/<session_id>/baton/claim", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const sessionId = ctx.params["session_id"] as string;
    const body = z.object({ version: z.number({ int: true }) }).parse(ctx.body);
    const version = body.version;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new ApiError("validation", "version must be an integer", { fields: { version: "must be an integer" } });
    }
    const result = await batonChange(svc, sessionId, user, { kind: "claim", version });
    return json(200, { session: result.session });
  });

  router.add("POST", "/api/sessions/<session_id>/baton/pass", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const sessionId = ctx.params["session_id"] as string;
    const body = z.object({ to_user_id: z.string({ min: 1 }), version: z.number({ int: true }) }).parse(ctx.body);
    const toUserId = body.to_user_id;
    const version = body.version;
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new ApiError("validation", "version must be an integer", { fields: { version: "must be an integer" } });
    }
    const result = await batonChange(svc, sessionId, user, { kind: "pass", version, toUserId });
    return json(200, { session: result.session });
  });
}

async function ownerId(client: PoolClient, projectId: string): Promise<string> {
  const r = await client.query(`SELECT owner_id FROM projects WHERE id = $1`, [projectId]);
  return (r.rows[0] as { owner_id: string }).owner_id;
}

async function sessionRow(client: PoolClient, sessionId: string) {
  const r = await client.query(
    `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (r.rowCount === 0) throw new ApiError("not_found", "No such session.");
  return r.rows[0] as {
    id: string; project_id: string; title: string; state: "scheduled" | "live" | "paused" | "ended";
    scheduled_for: Date; driver_id: string | null; version: number;
  };
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

async function publishSession(svc: Services, projectId: string, s: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = sessionOutRow(s);
  svc.bus.publish(projectId, { type: "session", session: out });
  return out;
}

interface BatonRequest {
  kind: "claim" | "pass";
  version: number;
  toUserId?: string;
}

async function batonChange(
  svc: Services,
  sessionId: string,
  user: { id: string; name: string },
  req: BatonRequest,
): Promise<{ session: Record<string, unknown> }> {
  const client = await svc.pool.connect();
  let out: Record<string, unknown>;
  let projectId = "";
  try {
    await client.query("BEGIN");
    const s = await sessionWithLock(client, sessionId);
    projectId = s.project_id;
    const role = await requireMembership(svc.pool, projectId, user.id);
    if (s.state !== "live") {
      throw new ApiError("session_not_live", "The baton is only passed during a live session.", { state: s.state });
    }
    let target: string;
    if (req.kind === "claim") {
      target = user.id;
    } else {
      if (role !== "mentor" && s.driver_id !== user.id) {
        throw new ApiError("forbidden", "Only the mentor or the driver may pass the baton.");
      }
      const targetRole = await requireMembership(svc.pool, projectId, req.toUserId as string);
      if (targetRole === null) {
        throw new ApiError("validation", "to_user_id must be the mentor or a student member", {
          fields: { to_user_id: "must be the mentor or a student member" },
        });
      }
      target = req.toUserId as string;
    }
    if (s.driver_id === target) {
      throw new ApiError("already_driving", "That participant is already driving.");
    }
    if (s.version !== req.version) {
      const winner = await client.query(`SELECT name FROM users WHERE id = $1`, [s.driver_id]);
      throw new ApiError("baton_taken", `${((winner.rows[0] as { name: string } | undefined)?.name) ?? "Someone"} took the baton first.`, {
        driver_id: s.driver_id,
        driver_name: (winner.rows[0] as { name: string } | undefined)?.name ?? "",
        version: s.version,
      });
    }
    const newVersion = s.version + 1;
    await client.query(
      `UPDATE sessions SET driver_id = $1, version = $2 WHERE id = $3`,
      [target, newVersion, sessionId],
    );
    const fresh = await client.query(
      `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions WHERE id = $1`,
      [sessionId],
    );
    out = sessionOutRow(fresh.rows[0] as Record<string, unknown>);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  svc.bus.publish(projectId, { type: "session", session: out });
  return { session: out };
}

async function requireMembership(pool: { query: (sql: string, params: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }> }, projectId: string, userId: string): Promise<"mentor" | "student" | null> {
  const r = await pool.query(`SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
  if (r.rowCount === 0) throw new ApiError("not_found", "No such project.");
  return (r.rows[0] as { role: string }).role as "mentor" | "student";
}
