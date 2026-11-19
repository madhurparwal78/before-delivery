import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const kc = config.keycloak;
const TOKEN_URL = `${kc.issuer}/protocol/openid-connect/token`;
export const AUTHORIZE_URL = `${kc.issuer}/protocol/openid-connect/auth`;

export interface Claims {
  sub: string;
  iss?: string;
  azp?: string;
  exp?: number;
  nonce?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (response.status >= 500) throw new ProviderDown("keycloak", `HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    throw new ProviderDown("keycloak", error instanceof Error ? error.message : String(error));
  }
}

const form = (values: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

function decodePart<T>(part: string | undefined): T {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as T;
}

export async function exchangeCode(code: string, verifier: string): Promise<{ access_token: string; id_token?: string } | null> {
  const response = await call(TOKEN_URL, form({
    grant_type: "authorization_code",
    client_id: kc.clientId,
    client_secret: kc.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: `${config.publicUrl}/auth/callback`,
  }));
  if (!response.ok) return null;
  return (await response.json()) as { access_token: string; id_token?: string };
}

export function idTokenNonce(idToken: string): string | undefined {
  return decodePart<Claims>(idToken.split(".")[1]).nonce;
}

// ---- access token verification against the realm's signing keys ----

interface Jwk extends JsonWebKey {
  kid?: string;
  use?: string;
}
let signingKeys = new Map<string, Jwk>();

async function signingKey(kid: string): Promise<Jwk | undefined> {
  if (!signingKeys.has(kid)) {
    const response = await call(`${kc.issuer}/protocol/openid-connect/certs`);
    const body = (await response.json()) as { keys?: Jwk[] };
    signingKeys = new Map((body.keys ?? []).filter((key) => key.kid && key.use !== "enc").map((key) => [key.kid as string, key]));
  }
  return signingKeys.get(kid);
}

/** The claims of a realm-signed access token issued to this app's client, or null. */
export async function verifyAccessToken(token: string): Promise<Claims | null> {
  const [head, payload, signature] = token.split(".");
  if (!head || !payload || !signature) return null;
  try {
    const header = decodePart<{ alg?: string; kid?: string }>(head);
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = await signingKey(header.kid);
    if (!jwk) return null;
    const valid = verify("RSA-SHA256", Buffer.from(`${head}.${payload}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
    if (!valid) return null;
    const claims = decodePart<Claims>(payload);
    if (claims.iss !== kc.issuer || claims.azp !== kc.clientId || !claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch (error) {
    if (error instanceof ProviderDown) throw error;
    return null;
  }
}

// ---- admin API through the app client's own service account ----

let service: { token: string; until: number } | null = null;

async function serviceToken(): Promise<string> {
  if (service && service.until > Date.now()) return service.token;
  const response = await call(TOKEN_URL, form({ grant_type: "client_credentials", client_id: kc.clientId, client_secret: kc.clientSecret }));
  if (!response.ok) throw new ProviderDown("keycloak", `service token HTTP ${response.status}`);
  const tokens = (await response.json()) as { access_token: string; expires_in: number };
  service = { token: tokens.access_token, until: Date.now() + (tokens.expires_in - 30) * 1000 };
  return service.token;
}

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await serviceToken()}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return call(`${kc.url}/admin/realms/${kc.realm}${path}`, init);
}

async function adminJson<T>(path: string): Promise<T> {
  const response = await admin("GET", path);
  if (!response.ok) throw new Error(`Keycloak GET ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export async function ensureRealmRole(name: string): Promise<void> {
  const found = await admin("GET", `/roles/${encodeURIComponent(name)}`);
  if (found.status !== 404) return;
  const created = await admin("POST", "/roles", { name });
  if (!created.ok && created.status !== 409) throw new Error(`Keycloak role ${name}: ${created.status}`);
}

export interface SeedUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

async function userId(username: string): Promise<string | undefined> {
  const found = await adminJson<{ id: string; username: string }[]>(`/users?username=${encodeURIComponent(username)}&exact=true`);
  return found.find((user) => user.username === username)?.id;
}

/** The user's id, creating them (verified email, permanent password) when missing. */
export async function ensureUser(user: SeedUser): Promise<string> {
  const existing = await userId(user.username);
  if (existing) return existing;
  const created = await admin("POST", "/users", {
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: true,
    emailVerified: true,
    requiredActions: [],
    credentials: [{ type: "password", value: user.password, temporary: false }],
  });
  if (!created.ok && created.status !== 409) throw new Error(`Keycloak create ${user.username}: ${created.status}`);
  const id = await userId(user.username);
  if (!id) throw new Error(`Keycloak user ${user.username} missing after create`);
  return id;
}

export async function grantRealmRoles(id: string, roles: readonly string[]): Promise<void> {
  const reps = await Promise.all(roles.map((role) => adminJson<{ id: string; name: string }>(`/roles/${encodeURIComponent(role)}`)));
  const response = await admin("POST", `/users/${id}/role-mappings/realm`, reps.map(({ id: roleId, name }) => ({ id: roleId, name })));
  if (!response.ok) throw new Error(`Keycloak role mapping: ${response.status}`);
}
