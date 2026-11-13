// Keycloak: the realm's OIDC endpoints and the admin API used through the app client's service account.
import { config } from "./config.js";
import { expectOk, reach } from "./providers/reach.js";

export type Role = "producer" | "client" | "sponsor" | "crew";
const ROLES: readonly Role[] = ["producer", "client", "sponsor", "crew"];

export const oidc = {
  authorize: `${config.keycloak.issuer}/protocol/openid-connect/auth`,
  token: `${config.keycloak.issuer}/protocol/openid-connect/token`,
  certs: `${config.keycloak.issuer}/protocol/openid-connect/certs`,
  logout: `${config.keycloak.issuer}/protocol/openid-connect/logout`,
  discovery: `${config.keycloak.issuer}/.well-known/openid-configuration`,
};

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token?: string;
}

/** POST to the token endpoint; null when Keycloak refuses the grant. */
export async function tokenGrant(form: Record<string, string>): Promise<TokenSet | null> {
  const response = await reach("keycloak", oidc.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.keycloak.clientId, client_secret: config.keycloak.clientSecret, ...form }).toString(),
  }, 10_000);
  if (response.status !== 200) return null;
  return (await response.json()) as TokenSet;
}

export function claims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export function realmRoles(accessClaims: Record<string, unknown>): Role[] {
  const access = accessClaims.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(access?.roles) ? access.roles : [];
  return ROLES.filter((r) => roles.includes(r));
}

const adminBase = `${config.keycloak.url}/admin/realms/${encodeURIComponent(config.keycloak.realm)}`;

let serviceToken: { value: string; until: number } | null = null;

async function adminToken(): Promise<string> {
  if (serviceToken && serviceToken.until > Date.now()) return serviceToken.value;
  const response = await reach("keycloak", `${config.keycloak.url}/realms/${encodeURIComponent(config.keycloak.realm)}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.keycloak.clientId, client_secret: config.keycloak.clientSecret }).toString(),
  }, 10_000);
  await expectOk("keycloak", response, 200);
  const granted = (await response.json()) as { access_token: string; expires_in: number };
  serviceToken = { value: granted.access_token, until: Date.now() + (granted.expires_in - 30) * 1000 };
  return granted.access_token;
}

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  return reach("keycloak", `${adminBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await adminToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, 10_000);
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export function displayName(user: KeycloakUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.username;
}

async function roleRepresentation(role: Role): Promise<unknown> {
  return (await expectOk("keycloak", await admin("GET", `/roles/${role}`), 200)).json();
}

export async function grantRole(userId: string, role: Role): Promise<void> {
  await expectOk("keycloak", await admin("POST", `/users/${userId}/role-mappings/realm`, [await roleRepresentation(role)]), 204);
}

export async function userHasRole(userId: string, role: Role): Promise<KeycloakUser | null> {
  const user = await admin("GET", `/users/${userId}`);
  if (user.status === 404) return null;
  await expectOk("keycloak", user, 200);
  const mapped = (await (await expectOk("keycloak", await admin("GET", `/users/${userId}/role-mappings/realm/composite`), 200)).json()) as { name: string }[];
  return mapped.some((r) => r.name === role) ? ((await user.json()) as KeycloakUser) : null;
}

export async function usersWithRole(role: Role): Promise<KeycloakUser[]> {
  return (await (await expectOk("keycloak", await admin("GET", `/roles/${role}/users?max=500`), 200)).json()) as KeycloakUser[];
}

const SEEDED: readonly { first: string; last: string; email: string; password: string; role: Role }[] = [
  { first: "Mara", last: "Lind", email: "mara@spindrift.test", password: "Spindrift-Producer-26", role: "producer" },
  { first: "Theo", last: "Vance", email: "theo@northwake.test", password: "Northwake-Client-26", role: "client" },
  { first: "Priya", last: "Raman", email: "priya@lumenhall.test", password: "Lumenhall-Client-26", role: "client" },
  { first: "Jonah", last: "Reyes", email: "jonah@crew.spindrift.test", password: "Crew-Jonah-26", role: "crew" },
  { first: "Ama", last: "Boateng", email: "ama@crew.spindrift.test", password: "Crew-Ama-26", role: "crew" },
];

async function findUser(username: string): Promise<KeycloakUser | null> {
  const found = (await (await expectOk("keycloak", await admin("GET", `/users?exact=true&username=${encodeURIComponent(username)}`), 200)).json()) as KeycloakUser[];
  return found[0] ?? null;
}

/** Ensures the four realm roles and the seeded accounts exist (idempotent, safe across instances). */
export async function ensureRealm(): Promise<void> {
  for (const role of ROLES) {
    const existing = await admin("GET", `/roles/${role}`);
    if (existing.status === 404) await expectOk("keycloak", await admin("POST", "/roles", { name: role }), 201, 409);
    else await expectOk("keycloak", existing, 200);
  }
  for (const seed of SEEDED) {
    let user = await findUser(seed.email);
    if (!user) {
      await expectOk("keycloak", await admin("POST", "/users", {
        username: seed.email, email: seed.email, firstName: seed.first, lastName: seed.last, enabled: true, emailVerified: true,
        credentials: [{ type: "password", value: seed.password, temporary: false }],
      }), 201, 409);
      user = await findUser(seed.email);
    }
    if (user && !(await userHasRole(user.id, seed.role))) await grantRole(user.id, seed.role);
  }
}
