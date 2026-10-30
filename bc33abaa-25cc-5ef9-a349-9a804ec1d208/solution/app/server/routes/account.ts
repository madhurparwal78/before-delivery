// Health, sign-up, sessions, the workspace, the dashboard, the audit trail and search.
import { randomBytes } from "node:crypto";
import type { Member, Role } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { isName, isRecord, type FieldErrors } from "../../shared/graph.js";
import { authorOf, hashPassword, sessionCookie, startSession, verifyPassword, type Caller } from "../auth.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { one, pool, rows, transaction, type Db } from "../db.js";
import { conflict, invalid, invalidCredentials } from "../errors.js";
import { json, noContent, publicRoute, route, type Context } from "../http.js";
import { authorize } from "../domain/permissions.js";
import { seatsPurchased, toSubscription, currentSubscription } from "../domain/subscription.js";
import { seatsUsed } from "../domain/seats.js";
import { isTimeZone, loadWorkspace, workspaceOut, workspaceSummary } from "../workspace.js";

export const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

export function bodyOf(ctx: Context): Record<string, unknown> {
  const body = ctx.body();
  if (!isRecord(body)) throw invalid({ body: "Send a JSON object" });
  return body;
}

export interface MemberRow { id: string; workspace_id: string; name: string; email: string; role: Role; joined_at: Date; password_hash: string; removed_at: Date | null }

export const memberOut = (m: MemberRow): Member => ({ id: m.id, name: m.name, email: m.email, role: m.role, joinedAt: isoSecond(m.joined_at) });

export async function emailTaken(db: Db, email: string): Promise<boolean> {
  return (await one(db, "SELECT 1 FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email])) !== undefined;
}

publicRoute("GET", "/api/health", async () => json(200, { status: "ok" }));

publicRoute("POST", "/api/signup", async (ctx) => {
  const body = bodyOf(ctx);
  const errors: FieldErrors = {};
  if (!isName(body.workspaceName)) errors.workspaceName = "Use 1 to 80 characters";
  if (!isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (typeof body.email !== "string" || !EMAIL.test(body.email)) errors.email = "Enter an email address";
  if (typeof body.password !== "string" || body.password.length < 10) errors.password = "Use at least 10 characters";
  if (!isTimeZone(body.timeZone)) errors.timeZone = "Choose a time zone";
  if (typeof body.email === "string" && EMAIL.test(body.email) && await emailTaken(pool, body.email)) throw conflict("email_taken");
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const workspaceId = newId("ws");
  const memberId = newId("mem");
  const passwordHash = await hashPassword(String(body.password));
  const now = new Date();
  const { member, token } = await transaction(async (client) => {
    if (await emailTaken(client, String(body.email))) throw conflict("email_taken");
    await client.query("INSERT INTO workspaces (id, name, time_zone, signing_secret, created_at) VALUES ($1, $2, $3, $4, $5)",
      [workspaceId, body.workspaceName, body.timeZone, `whsec_${randomBytes(12).toString("hex")}`, now]);
    const [created] = await rows<MemberRow>(client,
      "INSERT INTO members (id, workspace_id, name, email, password_hash, role, joined_at) VALUES ($1, $2, $3, $4, $5, 'owner', $6) RETURNING *",
      [memberId, workspaceId, body.name, body.email, passwordHash, now]);
    await client.query(
      "INSERT INTO subscriptions (workspace_id, state, plan, period, trial_ends_at) VALUES ($1, 'trial', 'team', 'monthly', $2)",
      [workspaceId, new Date(now.getTime() + config.trialLengthSeconds * 1000)]);
    await audit(client, workspaceId, { kind: "member", id: memberId, name: created.name }, "workspace.created", { type: "workspace", id: workspaceId });
    return { member: created, token: await startSession(client, memberId) };
  });
  const ws = await loadWorkspace(pool, workspaceId);
  return json(201, {
    workspace: workspaceSummary(ws), member: memberOut(member), subscription: toSubscription(await currentSubscription(workspaceId), new Date()),
  }, { "Set-Cookie": sessionCookie(token) });
});

publicRoute("POST", "/api/auth/login", async (ctx) => {
  const body = bodyOf(ctx);
  if (typeof body.email !== "string" || typeof body.password !== "string") throw invalidCredentials();
  const member = await one<MemberRow>(pool, "SELECT * FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [body.email]);
  if (!member || !(await verifyPassword(body.password, member.password_hash))) throw invalidCredentials();
  const token = await startSession(pool, member.id);
  return json(200, { member: memberOut(member), workspace: workspaceSummary(await loadWorkspace(pool, member.workspace_id)) },
    { "Set-Cookie": sessionCookie(token) });
});

route("POST", "/api/auth/logout", async (ctx) => {
  if (ctx.caller.kind === "member") await pool.query("UPDATE sessions SET ended_at = now() WHERE token_hash = $1", [ctx.caller.sessionHash]);
  return noContent({ "Set-Cookie": "orrery_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
});

route("GET", "/api/me", async ({ caller }) => {
  const ws = await loadWorkspace(pool, caller.workspaceId);
  if (caller.kind === "agent") return json(200, { agent: { id: caller.id, name: caller.name, scope: caller.scope }, workspace: workspaceSummary(ws) });
  const [member] = await rows<MemberRow>(pool, "SELECT * FROM members WHERE id = $1", [caller.id]);
  const subscription = toSubscription(await currentSubscription(ws.id), new Date());
  // The Service status banner names the reopened invoice on every app screen, for every member.
  const overdue = subscription.state === "past_due"
    ? await one<{ invoice_number: string }>(pool,
      "SELECT invoice_number FROM payments WHERE workspace_id = $1 AND charged_back ORDER BY created_at DESC LIMIT 1", [ws.id])
    : undefined;
  return json(200, {
    member: memberOut(member), workspace: workspaceSummary(ws), subscription,
    overdueInvoice: overdue?.invoice_number ?? null,
  });
});

route("GET", "/api/workspace", async ({ caller }) => {
  authorize(caller, "workspace.read");
  return json(200, workspaceOut(await loadWorkspace(pool, caller.workspaceId)));
});

route("PATCH", "/api/workspace", async (ctx) => {
  authorize(ctx.caller, "workspace.settings");
  const body = bodyOf(ctx);
  const errors: FieldErrors = {};
  if (body.name !== undefined && !isName(body.name)) errors.name = "Use 1 to 80 characters";
  if (body.timeZone !== undefined && !isTimeZone(body.timeZone)) errors.timeZone = "Choose a time zone";
  if (body.reviewLinksEnabled !== undefined && typeof body.reviewLinksEnabled !== "boolean") errors.reviewLinksEnabled = "Must be true or false";
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const ws = await loadWorkspace(pool, ctx.caller.workspaceId);
  await transaction(async (client) => {
    await client.query("UPDATE workspaces SET name = $2, time_zone = $3, review_links_enabled = $4 WHERE id = $1",
      [ws.id, body.name ?? ws.name, body.timeZone ?? ws.time_zone, body.reviewLinksEnabled ?? ws.review_links_enabled]);
    await audit(client, ws.id, authorOf(ctx.caller), "workspace.updated", { type: "workspace", id: ws.id });
  });
  return json(200, workspaceOut(await loadWorkspace(pool, ws.id)));
});

async function dashboardFor(caller: Caller) {
  const now = new Date();
  const sub = await currentSubscription(caller.workspaceId);
  const counts = await one<{ scenes: number; published: number; scheduled: number; tokens: number }>(pool,
    `SELECT (SELECT count(*) FROM scenes WHERE workspace_id = $1)::int AS scenes,
            (SELECT count(DISTINCT scene_id) FROM versions WHERE workspace_id = $1 AND state = 'published')::int AS published,
            (SELECT count(*) FROM versions WHERE workspace_id = $1 AND state = 'scheduled')::int AS scheduled,
            (SELECT count(*) FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > $2)::int AS tokens`,
    [caller.workspaceId, now]);
  return {
    seatsUsed: await seatsUsed(pool, caller.workspaceId, now), seatsPurchased: seatsPurchased(sub),
    scenes: counts?.scenes ?? 0, publishedScenes: counts?.published ?? 0, scheduledVersions: counts?.scheduled ?? 0,
    activeAgentTokens: counts?.tokens ?? 0, subscription: toSubscription(sub, now),
  };
}

route("GET", "/api/dashboard", async ({ caller }) => {
  authorize(caller, "workspace.read");
  return json(200, await dashboardFor(caller));
});

route("GET", "/api/audit", async ({ caller, query }) => {
  authorize(caller, "member.manage");
  const raw = query.get("limit");
  const limit = raw === null ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw invalid({ limit: "Use a whole number from 1 to 500" });
  const entries = await rows<{ id: number; at: Date; actor_kind: Caller["kind"] | "system"; actor_id: string; actor_name: string; action: string; target_type: string; target_id: string }>(pool,
    "SELECT * FROM audit_entries WHERE workspace_id = $1 ORDER BY at DESC, id DESC LIMIT $2", [caller.workspaceId, limit]);
  return json(200, {
    entries: entries.map((e) => ({
      id: String(e.id), at: isoSecond(e.at), actor: { kind: e.actor_kind, id: e.actor_id, name: e.actor_name },
      action: e.action, target: { type: e.target_type, id: e.target_id },
    })),
  });
});

route("GET", "/api/search", async ({ caller, query }) => {
  authorize(caller, "scene.read");
  const q = query.get("q") ?? "";
  if ([...q].length < 2) throw invalid({ q: "Type at least 2 characters" });
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [scenes, assets] = await Promise.all([
    rows<{ id: string; name: string }>(pool, "SELECT id, name FROM scenes WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name, id", [caller.workspaceId, pattern]),
    rows<{ id: string; name: string }>(pool, "SELECT id, name FROM assets WHERE workspace_id = $1 AND name ILIKE $2 ORDER BY name, id", [caller.workspaceId, pattern]),
  ]);
  return json(200, { scenes, assets });
});

