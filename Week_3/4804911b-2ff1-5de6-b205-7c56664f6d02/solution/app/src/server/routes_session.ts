import { clearedCookie, closeSession, openSession, sessionBody, sessionCookie, tokenOf, verifyPassword } from "./auth.js";
import { db } from "./db.js";
import { ApiError, validation } from "./errors.js";
import { COPY } from "../shared/copy.js";
import { json, route } from "./http.js";
import { beginSignIn } from "./limits.js";

route("POST", "/api/session", { auth: "public", body: "json", guard: (ctx) => beginSignIn(ctx.ip) }, async (ctx) => {
  const { email, password } = ctx.body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") throw validation({ email: "Send an email and a password." });
  const found = await db.query("SELECT * FROM accounts WHERE lower(email) = lower($1)", [email.trim()]);
  const row = found.rows[0];
  const ok = row ? await verifyPassword(password, row.password_hash as string) : false;
  if (!row || !ok) throw new ApiError(401, "bad_credentials", COPY.badCredentials);
  const previous = tokenOf(ctx.req);
  if (previous) await closeSession(previous);
  const token = await openSession(row.id as string);
  const account = { id: row.id as string, role: row.role as "editor" | "stockist", email: row.email as string, displayName: row.display_name as string };
  return json(200, sessionBody(account), { "set-cookie": sessionCookie(token) });
});

route("GET", "/api/session", { auth: "any" }, async (ctx) => json(200, sessionBody(ctx.account!)));

route("DELETE", "/api/session", { auth: "any" }, async (ctx) => {
  await closeSession(tokenOf(ctx.req)!);
  return { status: 204, headers: { "set-cookie": clearedCookie } };
});
