// Health, session, identity and the key-guarded grading routes.
import { config } from "../config.ts";
import { pool, readClock, transaction } from "../db.ts";
import { startSession, toPrincipal, verifyPassword } from "../auth.ts";
import { ApiError, notFound, seedConflict } from "../errors.ts";
import { ok, created, noContent, sessionCookie, type Ctx, type Router } from "../http.ts";
import { loadSeed, principalsExist, resetAll } from "../seed.ts";
import { storageReachable } from "../storage.ts";
import { runDueTimers } from "../timers.ts";
import { localDate, toIso } from "../../shared/dates.ts";
import type { MeResponse } from "../../shared/api.ts";

const invalidCredentials = (): ApiError => new ApiError(422, "invalid_credentials", "Email or password is incorrect.");

function guard(ctx: Ctx): void {
  const given = ctx.req.headers["x-grading-key"];
  if (!config.gradingKey || given !== config.gradingKey) throw notFound();
}

export function registerCore(router: Router): void {
  router.get("/api/health", async () => {
    const database = await pool.query("SELECT 1").then(() => true, () => false);
    return ok({ status: database && (await storageReachable()) ? "ok" : "unavailable" });
  });

  router.post("/api/session", async (ctx) => {
    const body = await ctx.json();
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const row = (await pool.query<{ id: string; display_name: string; role: never; organisation_id: string; password_hash: string }>(
      "SELECT id, display_name, role, organisation_id, password_hash FROM principals WHERE lower(email) = lower($1)", [email])).rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) throw invalidCredentials();
    const token = await transaction((tx) => startSession(tx, row.id));
    return { ...ok({ principal: toPrincipal(row) }), headers: { "set-cookie": sessionCookie(token) } };
  });

  router.delete("/api/session", async (ctx) => {
    ctx.user();
    await pool.query("DELETE FROM sessions WHERE token = $1", [ctx.cookies[config.sessionCookieName]]);
    return noContent({ "set-cookie": sessionCookie("", true) });
  });

  router.get("/api/me", async (ctx) => {
    const principal = ctx.user();
    const now = await readClock(pool);
    const org = (await pool.query<{ starts: string | null; ends: string | null; territories: string[] | null }>(
      "SELECT engagement_starts_on AS starts, engagement_ends_on AS ends, engagement_territories AS territories FROM organisations WHERE id = $1",
      [principal.organisationId])).rows[0];
    const me: MeResponse = {
      principal,
      engagement: principal.role === "agency" && org.starts && org.ends && org.territories ? { startsOn: org.starts, endsOn: org.ends, territories: org.territories } : null,
      today: localDate(now, config.timeZone),
      now,
      timeZone: config.timeZone,
      weightAnnounceDelayMs: config.weightAnnounceDelayMs,
    };
    return ok(me);
  });

  router.post("/api/grading/reset", async (ctx) => {
    guard(ctx);
    return ok({ now: await resetAll() });
  });

  router.post("/api/grading/seed", async (ctx) => {
    guard(ctx);
    const body = await ctx.json();
    if (await transaction(principalsExist)) throw seedConflict();
    return created(await loadSeed(body));
  });

  router.post("/api/grading/clock", async (ctx) => {
    guard(ctx);
    const body = await ctx.json();
    const now = await transaction(async (tx) => {
      const current = Date.parse(tx.now);
      const target =
        typeof body.advanceMinutes === "number" ? current + body.advanceMinutes * 60_000
        : typeof body.setTo === "string" ? Date.parse(body.setTo)
        : NaN;
      if (Number.isNaN(target)) throw new ApiError(422, "invalid_body", "Request body is not valid JSON.");
      await tx.q("UPDATE app_clock SET now = $1 WHERE id = 1", [toIso(target)]);
      tx.live({ type: "library.updated" }, { all: true });
      tx.live({ type: "queue.updated" }, { all: true });
      return toIso(target);
    });
    await runDueTimers();
    return ok({ now });
  });

  router.post("/api/grading/audit/tamper", async (ctx) => {
    guard(ctx);
    const body = await ctx.json();
    const rows = await pool.query("UPDATE audit SET after = $2 WHERE sequence = $1 RETURNING sequence", [body.sequence, JSON.stringify(body.after ?? null)]);
    if (rows.rowCount === 0) throw notFound();
    return ok({ sequence: body.sequence });
  });
}

