import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const kc = config.keycloak;
const TOKEN_URL = `${kc.issuer}/protocol/openid-connect/token`;
export const AUTHORIZE_URL = `${kc.issuer}/protocol/openid-connect/auth`;

interface TokenSet {
  access_token: string;
  id_token?: string;
  expires_in: number;
}

interface TokenClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  nonce?: string;
  realm_access?: { roles?: string[] };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (response.status >= 500) throw new ProviderDown("keycloak", `HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    throw new ProviderDown("keycloak", error instanceof Error ? error.message : String(error));
  }
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  };
}

export function claimsOf(jwt: string): TokenClaims {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
}

/** Password grant with the `app` client; null when Keycloak refuses the credentials. */
export async function passwordGrant(username: string, password: string): Promise<TokenSet | null> {
  const response = await call(TOKEN_URL, form({
    grant_type: "password",
    client_id: kc.clientId,
    client_secret: kc.clientSecret,
    username,
    password,
    scope: "openid",
  }));
  if (response.status === 401 || response.status === 400) return null;
  return (await response.json()) as TokenSet;
}

export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<TokenSet | null> {
  const response = await call(TOKEN_URL, form({
    grant_type: "authorization_code",
    client_id: kc.clientId,
    client_secret: kc.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  }));
  if (!response.ok) return null;
  return (await response.json()) as TokenSet;
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${kc.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// ---- admin API through the app client's own service account ----

let service: { token: string; until: number } | null = null;

async function serviceToken(): Promise<string> {
  if (service && service.until > Date.now()) return service.token;
  const response = await call(TOKEN_URL, form({ grant_type: "client_credentials", client_id: kc.clientId, client_secret: kc.clientSecret }));
  if (!response.ok) throw new ProviderDown("keycloak", `service token HTTP ${response.status}`);
  const tokens = (await response.json()) as TokenSet;
  service = { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 30) * 1000 };
  return service.token;
}

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await serviceToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return call(`${kc.url}/admin/realms/${kc.realm}${path}`, init);
}

async function adminJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await admin(method, path, body);
  if (!response.ok) throw new Error(`Keycloak ${method} ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

interface RoleRep {
  id: string;
  name: string;
}

interface GroupRep {
  id: string;
  name: string;
}

interface UserRep {
  id: string;
  username: string;
  email?: string;
  requiredActions?: string[];
}

export async function ensureRole(name: string): Promise<void> {
  const found = await admin("GET", `/roles/${encodeURIComponent(name)}`);
  if (found.status === 404) {
    const created = await admin("POST", "/roles", { name });
    if (!created.ok && created.status !== 409) throw new Error(`Keycloak role ${name}: ${created.status}`);
  }
}

export async function ensureGroup(name: string): Promise<string> {
  const search = await adminJson<GroupRep[]>("GET", `/groups?search=${encodeURIComponent(name)}&exact=true`);
  const existing = search.find((group) => group.name === name);
  if (existing) return existing.id;
  const created = await admin("POST", "/groups", { name });
  if (!created.ok && created.status !== 409) throw new Error(`Keycloak group ${name}: ${created.status}`);
  return ensureGroup(name);
}

export async function userByUsername(username: string): Promise<UserRep | undefined> {
  const found = await adminJson<UserRep[]>("GET", `/users?username=${encodeURIComponent(username)}&exact=true`);
  return found.find((user) => user.username === username.toLowerCase());
}

interface NewUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  requiredActions?: string[];
}

/** Creates the person, or returns null when the username or email is taken. */
export async function createUser(user: NewUser): Promise<string | null> {
  const body: Record<string, unknown> = {
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: true,
    emailVerified: true,
    requiredActions: user.requiredActions ?? [],
  };
  if (user.password) body.credentials = [{ type: "password", value: user.password, temporary: false }];
  const response = await admin("POST", "/users", body);
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`Keycloak create user: ${response.status}`);
  const location = response.headers.get("location") ?? "";
  return location.slice(location.lastIndexOf("/") + 1);
}

export async function grantRealmRoles(userId: string, roles: readonly string[]): Promise<void> {
  const reps = await Promise.all(roles.map((role) => adminJson<RoleRep>("GET", `/roles/${encodeURIComponent(role)}`)));
  const response = await admin("POST", `/users/${userId}/role-mappings/realm`, reps.map(({ id, name }) => ({ id, name })));
  if (!response.ok) throw new Error(`Keycloak role mapping: ${response.status}`);
}

export async function joinGroup(userId: string, groupId: string): Promise<void> {
  const response = await admin("PUT", `/users/${userId}/groups/${groupId}`);
  if (!response.ok) throw new Error(`Keycloak group join: ${response.status}`);
}

export async function groupsOf(userId: string): Promise<string[]> {
  const groups = await adminJson<GroupRep[]>("GET", `/users/${userId}/groups`);
  return groups.map((group) => group.name);
}

/** Sets a permanent password and clears the UPDATE_PASSWORD required action. */
export async function setPassword(userId: string, password: string): Promise<void> {
  const reset = await admin("PUT", `/users/${userId}/reset-password`, { type: "password", value: password, temporary: false });
  if (!reset.ok) throw new Error(`Keycloak reset password: ${reset.status}`);
  const user = await adminJson<UserRep>("GET", `/users/${userId}`);
  const cleared = await admin("PUT", `/users/${userId}`, {
    ...user,
    requiredActions: (user.requiredActions ?? []).filter((action) => action !== "UPDATE_PASSWORD"),
  });
  if (!cleared.ok) throw new Error(`Keycloak clear required action: ${cleared.status}`);
}
