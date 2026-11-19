import { config } from "../config.js";
import { EMAIL_PATTERN, hashPassword, newVerificationCode, passwordMatches, startSession } from "../auth.js";
import { now } from "../clock.js";
import { pool } from "../db.js";
import { fields, invalid, notFound, readJson, route, sendJson, sessionToken, ApiError, type Ctx } from "../http.js";
import { sendMail } from "../mail.js";
import { reachable } from "../s3.js";
import { teamsOf } from "../access.js";
import { randomUUID } from "node:crypto";
import { state, RAW, NO_CONTENT } from "../state.js";

const COOKIE_AGE = 60 * 60 * 24 * 30;

function sessionCookie(token: string, maxAge = COOKIE_AGE): string {
  return `everyweek_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

route("GET", "/api/health", async (ctx) => {
  if (!state.ready) return sendHealth(ctx, 503, "starting");
  return sendHealth(ctx, 200, (await reachable()) ? "ok" : "unavailable");
}, { open: true });

function sendHealth(ctx: Ctx, status: number, value: string): symbol {
  sendJson(ctx.res, status, { status: value });
  return RAW;
}

route("GET", "/api/config", async () => ({
  moveMs: config.limits.moveMs, progressMs: config.limits.progressMs, toastMs: config.limits.toastMs, holdTimeoutMs: config.limits.holdTimeoutMs,
}), { open: true });

route("POST", "/api/signup", async (ctx) => {
  const body = fields(await readJson(ctx));
  const errors: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) errors.name = "Enter your name";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like name@example.com";
  if (password.length < 8) errors.password = "Use at least 8 characters";
  if (!errors.email) {
    const taken = await pool.query("SELECT 1 FROM people WHERE lower(email) = lower($1)", [email]);
    if (taken.rowCount) errors.email = "That email already has an account";
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID();
  const code = newVerificationCode();
  const created = await pool.query(
    "INSERT INTO people (id, name, email, password_hash, verified, code, created_at) VALUES ($1,$2,$3,$4,false,$5,$6) ON CONFLICT DO NOTHING",
    [id, name, email, hashPassword(password), code, await now(pool)],
  );
  if (!created.rowCount) throw invalid({ email: "That email already has an account" });
  await sendMail(email, "Your Everyweek verification code", `Your Everyweek verification code is ${code}.\n`).catch(() => undefined);
  return { id, email, verified: false };
}, { open: true, status: 201 });

route("POST", "/api/verify", async (ctx) => {
  const body = fields(await readJson(ctx));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const { rows } = await pool.query("SELECT id, code, verified FROM people WHERE lower(email) = lower($1)", [email]);
  if (!rows.length) throw notFound();
  if (!rows[0].verified && rows[0].code !== String(body.code ?? "").trim()) throw invalid({ code: "That code is not right" });
  await pool.query("UPDATE people SET verified = true, code = NULL WHERE id = $1", [rows[0].id]);
  return { verified: true };
}, { open: true });

route("POST", "/api/signin", async (ctx) => {
  const body = fields(await readJson(ctx));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const { rows } = await pool.query("SELECT id, name, email, password_hash FROM people WHERE lower(email) = lower($1)", [email]);
  if (!rows.length || !passwordMatches(password, rows[0].password_hash)) throw new ApiError(401, { error: "invalid_credentials" });
  const token = await startSession(pool, rows[0].id);
  ctx.res.setHeader("set-cookie", sessionCookie(token));
  return { id: rows[0].id, name: rows[0].name, email: rows[0].email };
}, { open: true });

route("POST", "/api/signout", async (ctx) => {
  await pool.query("DELETE FROM sessions WHERE token = $1", [sessionToken(ctx.req)]);
  ctx.res.setHeader("set-cookie", sessionCookie("", 0));
  return NO_CONTENT;
}, { open: true });

route("GET", "/api/me", async (ctx) => {
  const { rows } = await pool.query("SELECT id, name, email, verified FROM people WHERE id = $1", [ctx.personId]);
  const memberships = await teamsOf(pool, ctx.personId);
  const names = await pool.query("SELECT id, name FROM teams WHERE id = ANY($1)", [memberships.map((m) => m.teamId)]);
  return {
    ...rows[0],
    teams: memberships.map((m) => ({ id: m.teamId, name: names.rows.find((n) => n.id === m.teamId)?.name, role: m.role })),
  };
});

route("POST", "/api/teams/join", async (ctx) => {
  const body = fields(await readJson(ctx));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const team = await pool.query("SELECT id, name FROM teams WHERE join_code = $1", [code]);
  if (!team.rows.length) throw notFound();
  const person = await pool.query("SELECT verified FROM people WHERE id = $1", [ctx.personId]);
  if (!person.rows[0].verified) throw new ApiError(403, { error: "not_verified" });
  await pool.query("INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [team.rows[0].id, ctx.personId]);
  return { teamId: team.rows[0].id, name: team.rows[0].name };
});
