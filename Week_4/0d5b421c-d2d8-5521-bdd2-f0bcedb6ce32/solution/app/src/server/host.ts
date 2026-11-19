// The host session: sign-in with the seeded account, live for 12 hours on the server clock.
import { createHash, randomBytes } from "node:crypto";
import type { HostSessionResponse } from "../shared/api.js";
import { catalog } from "./catalog.js";
import { addMinutes, instantIso, now } from "./clock.js";
import { pool, rows } from "./db.js";
import { apiErrors } from "./errors.js";
import { passwordMatches } from "./passwords.js";
import { objectBody } from "./validation.js";

export const SESSION_COOKIE = "ss_host";

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signIn(body: unknown): Promise<{ session: HostSessionResponse; token: string }> {
  const input = objectBody(body);
  const email = typeof input["email"] === "string" ? input["email"].trim().toLowerCase() : "";
  const password = typeof input["password"] === "string" ? input["password"] : "";
  const [account] = await rows<{ email: string; name: string; password_hash: string }>(
    pool,
    "SELECT email, name, password_hash FROM host_accounts WHERE email = $1",
    [email],
  );
  if (account === undefined || !passwordMatches(password, account.password_hash)) throw apiErrors.invalidCredentials();
  const token = randomBytes(32).toString("base64url");
  const signedInAt = now();
  const expiresAt = addMinutes(signedInAt, catalog().rules.host_session_hours * 60);
  await pool.query("INSERT INTO host_sessions (token_hash, email, signed_in_at, expires_at) VALUES ($1, $2, $3, $4)", [
    hashOf(token), account.email, signedInAt, expiresAt,
  ]);
  return { session: { host: { email: account.email, name: account.name }, expires_at: instantIso(expiresAt) }, token };
}

/** A session is live while the server's now is earlier than its sign-in instant plus 12 hours. */
export async function requireHostSession(token: string | null): Promise<void> {
  if (token === null) throw apiErrors.unauthenticated();
  const [session] = await rows<{ expires_at: Date }>(pool, "SELECT expires_at FROM host_sessions WHERE token_hash = $1", [hashOf(token)]);
  if (session === undefined || now() >= session.expires_at) throw apiErrors.unauthenticated();
}

export async function signOut(token: string | null): Promise<void> {
  if (token !== null) await pool.query("DELETE FROM host_sessions WHERE token_hash = $1", [hashOf(token)]);
}
