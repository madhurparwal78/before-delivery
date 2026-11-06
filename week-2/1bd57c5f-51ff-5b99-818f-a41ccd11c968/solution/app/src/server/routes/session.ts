import { FIELD_MESSAGES } from "../../shared/catalogue";
import type { User } from "../../shared/domain";
import { CLEARED_COOKIE, endOtherSessions, endSession, hashPassword, passwordMatches, startSession, type PersonRow } from "../auth";
import { maybeOne, one, pool, transaction } from "../db";
import { fail, invalid } from "../errors";
import { json, noContent, publicRoute, readJson, route } from "../http";

const PASSWORD_MAX = 200;
const PASSWORD_MIN = 10;

function userOf(person: PersonRow): { user: User } {
  return { user: { name: person.name, email: person.email, is_owner: person.is_owner } };
}

publicRoute("GET", "/api/health", async () => json(200, { status: "ok" }));

publicRoute("POST", "/api/session", async (call) => {
  const body = readJson(call);
  const errors: Record<string, string> = {};
  if (typeof body.email !== "string" || body.email.trim() === "") errors.email = "Enter your email address.";
  if (typeof body.password !== "string" || body.password === "") errors.password = "Enter your password.";
  if (Object.keys(errors).length > 0) invalid(errors);
  const person = await maybeOne<PersonRow & { password_hash: string }>(
    pool,
    "SELECT id, firm_id, name, email, is_owner, password_hash FROM people WHERE email = lower($1)",
    [String(body.email).trim()],
  );
  if (!person || !(await passwordMatches(String(body.password), person.password_hash))) fail("invalid_credentials");
  const cookie = await startSession(pool, person.id);
  return json(200, userOf(person), { "Set-Cookie": cookie });
});

route("DELETE", "/api/session", async (call) => {
  await endSession(pool, call.auth.tokenHash);
  return noContent({ "Set-Cookie": CLEARED_COOKIE });
});

route("GET", "/api/me", async (call) => json(200, userOf(call.auth.person)));

route("POST", "/api/me/password", async (call) => {
  const body = readJson(call);
  const { person, tokenHash } = call.auth;
  const { password_hash } = await one<{ password_hash: string }>(pool, "SELECT password_hash FROM people WHERE id = $1", [person.id]);
  const errors: Record<string, string> = {};
  if (typeof body.current_password !== "string" || !(await passwordMatches(body.current_password, password_hash))) {
    errors.current_password = "That isn't your current password.";
  }
  const next = typeof body.new_password === "string" ? body.new_password : "";
  if (next.length < PASSWORD_MIN) errors.new_password = FIELD_MESSAGES.new_password;
  else if (next.length > PASSWORD_MAX) errors.new_password = `New password must be ${PASSWORD_MAX} characters or fewer.`;
  if (Object.keys(errors).length > 0) invalid(errors);
  const hash = await hashPassword(next);
  await transaction(async (tx) => {
    await tx.query("UPDATE people SET password_hash = $2 WHERE id = $1", [person.id, hash]);
    await endOtherSessions(tx, person.id, tokenHash);
  });
  return json(200, { ok: true });
});
