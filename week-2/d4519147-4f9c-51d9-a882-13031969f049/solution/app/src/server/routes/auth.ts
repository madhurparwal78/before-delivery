import { auditAccount, eventJson, type EventRow } from "../audit.ts";
import { many, one, oneRow, pool, tx } from "../db.ts";
import { ApiError, sendEmpty, sendJson, validation } from "../http.ts";
import { assertNotLocked, clearPair, recordFailure } from "../lockout.ts";
import { decoyHash, hashPassword, verifyPassword } from "../passwords.ts";
import { route } from "../router.ts";
import { clearedCookie, endAllSessions, issueSession, sessionBody } from "../sessions.ts";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

const invalidCredentials = () => new ApiError(401, "invalid_credentials", "Email or password is incorrect.");

route("GET", "/api/session", { auth: "session" }, async ({ res, session }) => {
  sendJson(res, 200, sessionBody(session.user, session.csrfToken));
});

route("POST", "/api/session", { auth: "none" }, async (ctx) => {
  const body = ctx.body();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  await assertNotLocked(pool, email, ctx.ip);
  const user = email ? await one<UserRow>(pool, "SELECT id, email, display_name, password_hash FROM users WHERE email = $1", [email]) : undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? (await decoyHash));
  if (!user || !ok) {
    await tx((db) => recordFailure(db, email, ctx.ip, user?.id ?? null));
    throw invalidCredentials();
  }
  const issued = await tx(async (db) => {
    await clearPair(db, email, ctx.ip);
    return issueSession(db, ctx.req, user.id);
  });
  sendJson(ctx.res, 200, sessionBody({ id: user.id, email: user.email, displayName: user.display_name }, issued.csrfToken), { "Set-Cookie": issued.cookie });
});

route("DELETE", "/api/session", { auth: "session" }, async ({ res, session }) => {
  await endAllSessions(pool, session.user.id);
  sendEmpty(res, 204, { "Set-Cookie": clearedCookie() });
});

route("POST", "/api/session/password", { auth: "session" }, async (ctx) => {
  const { user } = ctx.session;
  await assertNotLocked(pool, user.email, ctx.ip);
  const body = ctx.body();
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const row = await oneRow<{ password_hash: string }>(pool, "SELECT password_hash FROM users WHERE id = $1", [user.id]);
  if (!(await verifyPassword(current, row.password_hash))) {
    await tx((db) => recordFailure(db, user.email, ctx.ip, user.id));
    throw validation({ currentPassword: "incorrect" });
  }
  const length = Array.from(next).length;
  if (length < 12 || length > 128) throw validation({ newPassword: "length" });
  if (next === current) throw validation({ newPassword: "unchanged" });
  const hash = await hashPassword(next);
  const issued = await tx(async (db) => {
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, user.id]);
    await endAllSessions(db, user.id);
    await clearPair(db, user.email, ctx.ip);
    await auditAccount(db, user.id, user.email, "password.changed", {});
    return issueSession(db, ctx.req, user.id);
  });
  sendJson(ctx.res, 200, sessionBody(user, issued.csrfToken), { "Set-Cookie": issued.cookie });
});

route("GET", "/api/account/audit", { auth: "session", getOnly: true }, async ({ res, session }) => {
  const rows = await many<EventRow>(pool, "SELECT id, at, actor, action, detail FROM audit_events WHERE account_id = $1 ORDER BY id DESC LIMIT 500", [session.user.id]);
  sendJson(res, 200, { events: rows.map(eventJson) });
});
