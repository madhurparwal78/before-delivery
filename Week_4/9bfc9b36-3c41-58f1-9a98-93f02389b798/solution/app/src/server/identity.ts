/** Keycloak: password and refresh grants, the admin calls that keep the realm and its users in step, and token checks. */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { config } from "./config.js";
import { identityUnavailable } from "./errors.js";
import type { Role } from "../shared/types.js";

const REALM_ROLES: readonly Role[] = ["sailmaker", "loft-hand", "yacht-owner"];

const realmUrl = `${config.keycloakUrl}/realms/${config.keycloakRealm}`;
const adminUrl = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`;
const tokenUrl = `${realmUrl}/protocol/openid-connect/token`;

export const identityState = { reachable: false, lastFailure: "" };

function unavailable(reason: string) {
  identityState.lastFailure = reason;
  return identityUnavailable();
}

async function call(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 500) throw new Error("identity provider error");
    identityState.reachable = true;
    return response;
  } catch (error) {
    identityState.reachable = false;
    identityState.lastFailure = `${init.method ?? "GET"} ${url}: ${error instanceof Error ? error.message : String(error)}`;
    throw identityUnavailable();
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

async function grant(form: Record<string, string>): Promise<Tokens | null> {
  const response = await call(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    refreshExpiresIn: body.refresh_expires_in,
  };
}

export const passwordGrant = (email: string, password: string) =>
  grant({ grant_type: "password", username: email, password, scope: "openid" });
export const refreshGrant = (refreshToken: string) => grant({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function endSession(refreshToken: string): Promise<void> {
  await call(`${realmUrl}/protocol/openid-connect/logout`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken }),
  }).catch(() => undefined);
}

export async function probeIdentity(): Promise<boolean> {
  try {
    const response = await fetch(`${realmUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    identityState.reachable = response.ok;
    return response.ok;
  } catch {
    identityState.reachable = false;
    return false;
  }
}

// ---- token verification -------------------------------------------------------------------

interface Jwk {
  kid?: string;
  kty: string;
  use?: string;
  [member: string]: unknown;
}

let keys = new Map<string, KeyObject>();
let keysFetchedAt = 0;

async function loadKeys(): Promise<void> {
  const response = await call(`${realmUrl}/protocol/openid-connect/certs`, {});
  const body = (await response.json()) as { keys: Jwk[] };
  const next = new Map<string, KeyObject>();
  for (const jwk of body.keys) {
    if (jwk.kty === "RSA" && jwk.kid && jwk.use !== "enc") next.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
  }
  keys = next;
  keysFetchedAt = Date.now();
}

async function keyFor(kid: string): Promise<KeyObject | null> {
  const cached = keys.get(kid);
  if (cached) return cached;
  if (Date.now() - keysFetchedAt > 3000) await loadKeys();
  return keys.get(kid) ?? null;
}

interface TokenClaims {
  sub: string;
}

const decode = (part: string): Buffer => Buffer.from(part, "base64url");

/** The subject of an access token this realm signed for this client, or null for anything else. */
export async function verifyToken(token: string): Promise<TokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: { sub?: string; iss?: string; exp?: number; azp?: string; typ?: string };
  try {
    header = JSON.parse(decode(parts[0]!).toString("utf8"));
    claims = JSON.parse(decode(parts[1]!).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const key = await keyFor(header.kid);
  if (!key) return null;
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify("RSA-SHA256", signed, key, decode(parts[2]!))) return null;
  if (claims.iss !== config.issuerUrl || claims.azp !== config.clientId || claims.typ !== "Bearer") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  return typeof claims.sub === "string" ? { sub: claims.sub } : null;
}

// ---- admin ----------------------------------------------------------------------------------

let adminToken: { value: string; expiresAt: number } | null = null;

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  if (!adminToken || adminToken.expiresAt < Date.now() + 10_000) {
    const response = await call(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
    });
    if (!response.ok) throw unavailable(`admin token ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    adminToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  }
  return call(`${adminUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${adminToken.value}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export async function ensureRealmRoles(): Promise<void> {
  for (const name of REALM_ROLES) {
    const found = await admin(`/roles/${encodeURIComponent(name)}`);
    if (found.status === 404) {
      const made = await admin("/roles", { method: "POST", body: JSON.stringify({ name }) });
      if (!made.ok && made.status !== 409) throw unavailable(`create role ${name} ${made.status}`);
    } else if (!found.ok) {
      throw unavailable(`read role ${name} ${found.status}`);
    }
  }
}

interface RealmUser {
  id: string;
}

export async function findUser(email: string): Promise<RealmUser | null> {
  const response = await admin(`/users?email=${encodeURIComponent(email)}&exact=true`);
  if (!response.ok) throw unavailable(`find user ${response.status}`);
  const users = (await response.json()) as { id: string; email?: string; username: string }[];
  const match = users.find((user) => (user.email ?? user.username).toLowerCase() === email.toLowerCase());
  return match ? { id: match.id } : null;
}

async function assignRole(userId: string, role: Role): Promise<void> {
  const found = await admin(`/roles/${encodeURIComponent(role)}`);
  if (!found.ok) throw unavailable("read role for mapping");
  const representation = await found.json();
  const mapped = await admin(`/users/${userId}/role-mappings/realm`, { method: "POST", body: JSON.stringify([representation]) });
  if (!mapped.ok) throw unavailable("map role");
}

async function setPassword(userId: string, password: string): Promise<void> {
  const response = await admin(`/users/${userId}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: password, temporary: false }),
  });
  if (!response.ok) throw unavailable("reset password");
}

/** Create the realm user for an account, or link to the user already holding that email and set its password and role. */
export async function provisionUser(email: string, displayName: string, password: string, role: Role): Promise<RealmUser> {
  let existing = await findUser(email);
  if (!existing) {
    const [first = displayName, ...rest] = displayName.split(" ");
    const created = await admin("/users", {
      method: "POST",
      body: JSON.stringify({
        username: email,
        email,
        emailVerified: true,
        enabled: true,
        firstName: first,
        lastName: rest.join(" ") || first,
        credentials: [{ type: "password", value: password, temporary: false }],
      }),
    });
    if (!created.ok && created.status !== 409) throw unavailable("create user");
    existing = await findUser(email);
    if (!existing) throw unavailable("find created user");
    await assignRole(existing.id, role);
    return existing;
  }
  await setPassword(existing.id, password);
  await assignRole(existing.id, role);
  return existing;
}

export async function deleteUser(userId: string): Promise<void> {
  const response = await admin(`/users/${userId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw unavailable("delete user");
}
