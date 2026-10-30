// Visitor accounts and sign-in with the app's own email-and-password accounts.
import { endLoginSession, hashPassword, passwordMatches, startLoginSession, type User } from "../auth.ts";
import { db } from "../db/index.ts";
import { ApiError, FieldErrors, ok, route } from "../http.ts";
import { newId } from "./ids.ts";
import { asObject, email, text } from "./validate.ts";

export const userView = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, organisation_id: u.organisation_id });

export function passwordError(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10 && value.length <= 200 ? null : "length";
}

route("POST", "/api/auth/register", "public", async (ctx) => {
  const body = asObject(ctx.body);
  const name = text(body.name, 1, 200);
  const address = email(body.email);
  if (address && (await db.one("SELECT 1 FROM users WHERE email = $1", [address]))) throw new ApiError(409, "email_taken");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "required";
  if (!address) errors.email = "invalid";
  const bad = passwordError(body.password);
  if (bad) errors.password = bad;
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const user: User = { id: newId(), email: address!, name: name!, role: "visitor", organisation_id: null };
  const inserted = await db.query("INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'visitor') ON CONFLICT (email) DO NOTHING",
    [user.id, user.email, user.name, await hashPassword(body.password as string)]);
  if (!inserted.rowCount) throw new ApiError(409, "email_taken");
  return { status: 201, body: { user: userView(user) }, headers: { "Set-Cookie": await startLoginSession(user.id) } };
});

route("POST", "/api/auth/signin", "public", async (ctx) => {
  const body = asObject(ctx.body);
  const address = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const row = await db.one<User & { password_hash: string }>("SELECT id, email, name, role, organisation_id, password_hash FROM users WHERE email = $1", [address]);
  if (!row || typeof body.password !== "string" || !(await passwordMatches(body.password, row.password_hash))) throw new ApiError(401, "invalid_credentials");
  return { status: 200, body: { user: userView(row) }, headers: { "Set-Cookie": await startLoginSession(row.id) } };
});

route("POST", "/api/auth/signout", "public", async (ctx) => ({ status: 204, headers: { "Set-Cookie": await endLoginSession(ctx.headers.cookie) } }));

route("GET", "/api/me", "signed-in", async (ctx) => ok({ user: userView(ctx.user) }));
