import { Router } from "express";
import { randomBytes } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth } from "../http";
import { audit } from "../audit";
import {
  newSessionToken, hashPassword, hashToken, SESSION_COOKIE,
} from "../auth";
import { loadEnv } from "../env";

export const authRouter = Router();

export function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

authRouter.post("/signup", async (req, res, next) => {
  try {
    const env = loadEnv();
    const body = req.body ?? {};
    const fieldErrors: Record<string, string> = {};
    const workspaceName = typeof body.workspaceName === "string" ? body.workspaceName : "";
    const name = typeof body.name === "string" ? body.name : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const timeZone = typeof body.timeZone === "string" ? body.timeZone : "";
    if (workspaceName.length < 1 || workspaceName.length > 80) fieldErrors.workspaceName = "Name must be 1-80 characters";
    if (name.length < 1 || name.length > 80) fieldErrors.name = "Name must be 1-80 characters";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Email is invalid";
    if (password.length < 10) fieldErrors.password = "Password must be at least 10 characters";
    if (!isValidTimeZone(timeZone)) fieldErrors.timeZone = "Time zone is invalid";
    if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
    const existing = await query("SELECT id FROM members WHERE email = $1 AND removed_at IS NULL", [email]);
    if (existing.rows.length > 0) throw errors.conflict("email_taken");
    const workspaceId = `ws_${randomBytes(9).toString("hex")}`;
    const memberId = `mem_${randomBytes(9).toString("hex")}`;
    const now = new Date();
    const client = await (await import("../db")).pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO workspaces (id, name, time_zone, gateway_secret) VALUES ($1,$2,$3,$4)",
        [workspaceId, workspaceName, timeZone, `whsec_${randomBytes(16).toString("hex")}`],
      );
      await client.query(
        "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1,$2,$3,$4,$5,'owner',$6)",
        [memberId, workspaceId, name, email, await hashPassword(password), now],
      );
      await client.query(
        "INSERT INTO subscriptions (workspace_id, state, plan, period, seats_purchased, extra_seats, trial_ends_at) VALUES ($1,'trial','team','monthly',8,0,$2)",
        [workspaceId, new Date(now.getTime() + env.trialLengthSeconds * 1000)],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { token } = newSessionToken();
    await query("INSERT INTO sessions (token_hash, member_id) VALUES ($1,$2)", [hashToken(token), memberId]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    const caller = { kind: "member" as const, member: { id: memberId, workspace_id: workspaceId, name, email, role: "owner" as const }, workspace: { id: workspaceId, name: workspaceName, time_zone: timeZone, review_links_enabled: true }, sessionId: token };
    audit(caller, "workspace.created", { type: "workspace", id: workspaceId });
    const sub = await query("SELECT state, plan, period, seats_purchased, extra_seats, trial_ends_at, grace_ends_at, pending_change FROM subscriptions WHERE workspace_id = $1", [workspaceId]);
    const s = sub.rows[0] as { state: string; plan: string; period: string; seats_purchased: number; extra_seats: number; trial_ends_at: Date; grace_ends_at: Date | null; pending_change: unknown };
    res.status(201).json({
      workspace: { id: workspaceId, name: workspaceName, timeZone },
      member: { id: memberId, name, email, role: "owner", joinedAt: iso(now) },
      subscription: {
        state: s.state, plan: s.plan, period: s.period,
        seatsPurchased: s.seats_purchased, extraSeats: s.extra_seats,
        trialEndsAt: iso(s.trial_ends_at), graceEndsAt: s.grace_ends_at ? iso(s.grace_ends_at) : null,
        pendingChange: s.pending_change ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/auth/login", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const res2 = await query(
      `SELECT m.id, m.password_hash FROM members m WHERE m.email = $1 AND m.removed_at IS NULL`,
      [email],
    );
    const row = res2.rows[0] as { id: string; password_hash: string } | undefined;
    const { verifyPassword } = await import("../auth");
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!ok) throw new (await import("../http")).HttpError(401, { error: "invalid_credentials" });
    const { token } = newSessionToken();
    await query("INSERT INTO sessions (token_hash, member_id) VALUES ($1,$2)", [hashToken(token), row!.id]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    const me = await query(
      `SELECT m.id, m.name, m.email, m.role, m.joined_at, w.id AS ws_id, w.name AS ws_name, w.time_zone, w.review_links_enabled
       FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.id = $1`,
      [row!.id],
    );
    const m = me.rows[0] as { id: string; name: string; email: string; role: string; joined_at: Date; ws_id: string; ws_name: string; time_zone: string; review_links_enabled: boolean };
    res.json({
      member: { id: m.id, name: m.name, email: m.email, role: m.role, joinedAt: iso(m.joined_at) },
      workspace: { id: m.ws_id, name: m.ws_name, timeZone: m.time_zone },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/auth/logout", async (req, res, next) => {
  try {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(raw)]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const caller = req.caller!;
    const wsRes = await query(
      "SELECT state, plan, period, seats_purchased, extra_seats, trial_ends_at, grace_ends_at, pending_change FROM subscriptions WHERE workspace_id = $1",
      [caller.workspace.id],
    );
    const s = wsRes.rows[0] as { state: string; plan: string; period: string; seats_purchased: number; extra_seats: number; trial_ends_at: Date; grace_ends_at: Date | null; pending_change: unknown } | undefined;
    const subscription = s
      ? {
          state: s.state, plan: s.plan, period: s.period,
          seatsPurchased: s.seats_purchased, extraSeats: s.extra_seats,
          trialEndsAt: iso(s.trial_ends_at), graceEndsAt: s.grace_ends_at ? iso(s.grace_ends_at) : null,
          pendingChange: s.pending_change ?? null,
        }
      : null;
    if (caller.kind === "agent") {
      res.json({ agent: { id: caller.token.id, name: caller.token.name, scope: caller.token.scope }, workspace: { id: caller.workspace.id, name: caller.workspace.name, timeZone: caller.workspace.time_zone } });
      return;
    }
    const joined = await query("SELECT joined_at FROM members WHERE id = $1", [caller.member.id]);
    res.json({
      member: { id: caller.member.id, name: caller.member.name, email: caller.member.email, role: caller.member.role, joinedAt: iso((joined.rows[0] as { joined_at: Date }).joined_at) },
      workspace: { id: caller.workspace.id, name: caller.workspace.name, timeZone: caller.workspace.time_zone },
      subscription,
    });
  } catch (e) {
    next(e);
  }
});

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

workspaceRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    res.json({
      id: caller.workspace.id,
      name: caller.workspace.name,
      timeZone: caller.workspace.time_zone,
      reviewLinksEnabled: caller.workspace.review_links_enabled,
    });
  } catch (e) {
    next(e);
  }
});

workspaceRouter.patch("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (caller.member.role !== "owner") throw errors.forbidden();
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 80) throw errors.validation({ name: "Name must be 1-80 characters" });
      updates.name = body.name;
    }
    if (body.timeZone !== undefined) {
      if (typeof body.timeZone !== "string" || !isValidTimeZone(body.timeZone)) throw errors.validation({ timeZone: "Time zone is invalid" });
      updates.time_zone = body.timeZone;
    }
    if (body.reviewLinksEnabled !== undefined) {
      if (typeof body.reviewLinksEnabled !== "boolean") throw errors.validation({ reviewLinksEnabled: "Must be a boolean" });
      updates.review_links_enabled = body.reviewLinksEnabled;
    }
    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(", ");
      await query(`UPDATE workspaces SET ${sets} WHERE id = $1`, [caller.workspace.id, ...Object.values(updates)]);
      audit(caller, "workspace.updated", { type: "workspace", id: caller.workspace.id });
    }
    const fresh = await query("SELECT id, name, time_zone, review_links_enabled FROM workspaces WHERE id = $1", [caller.workspace.id]);
    const w = fresh.rows[0] as { id: string; name: string; time_zone: string; review_links_enabled: boolean };
    res.json({ id: w.id, name: w.name, timeZone: w.time_zone, reviewLinksEnabled: w.review_links_enabled });
  } catch (e) {
    next(e);
  }
});

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    const ws = caller.member.workspace_id;
    const seatsUsedRes = await query(
      `SELECT
        (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL) +
        (SELECT count(*) FROM invites WHERE workspace_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now()) AS used`,
      [ws],
    );
    const seatsUsed = Number((seatsUsedRes.rows[0] as { used: string }).used);
    const dashRes = await query(
      `SELECT
        (SELECT count(*) FROM scenes WHERE workspace_id = $1) AS scenes,
        (SELECT count(DISTINCT v.scene_id) FROM versions v JOIN scenes s ON s.id = v.scene_id WHERE s.workspace_id = $1 AND v.state = 'published') AS published_scenes,
        (SELECT count(*) FROM versions v JOIN scenes s ON s.id = v.scene_id WHERE s.workspace_id = $1 AND v.state = 'scheduled') AS scheduled_versions,
        (SELECT count(*) FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > now()) AS active_tokens
       FROM workspaces WHERE id = $1`,
      [ws],
    );
    const d = dashRes.rows[0] as { scenes: string; published_scenes: string; scheduled_versions: string; active_tokens: string };
    const subRes = await query("SELECT state, plan, period, seats_purchased, extra_seats, trial_ends_at, grace_ends_at, pending_change FROM subscriptions WHERE workspace_id = $1", [ws]);
    const s = subRes.rows[0] as { state: string; plan: string; period: string; seats_purchased: number; extra_seats: number; trial_ends_at: Date; grace_ends_at: Date | null; pending_change: unknown };
    res.json({
      seatsUsed,
      seatsPurchased: s.seats_purchased,
      scenes: Number(d.scenes),
      publishedScenes: Number(d.published_scenes),
      scheduledVersions: Number(d.scheduled_versions),
      activeAgentTokens: Number(d.active_tokens),
      subscription: {
        state: s.state, plan: s.plan, period: s.period,
        seatsPurchased: s.seats_purchased, extraSeats: s.extra_seats,
        trialEndsAt: iso(s.trial_ends_at), graceEndsAt: s.grace_ends_at ? iso(s.grace_ends_at) : null,
        pendingChange: s.pending_change ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});


