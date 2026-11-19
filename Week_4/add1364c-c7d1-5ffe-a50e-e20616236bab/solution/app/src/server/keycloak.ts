import { config } from "./config.js";

/** Keycloak could not be reached, or answered something unusable. */
export class KeycloakUnavailable extends Error {}

const TIMEOUT_MS = 5000;
const ATTEMPTS = 3;
const BACKOFF_MS = [200, 500];
const admin = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`;
const tokenUrl = `${config.authIssuerUrl}/protocol/openid-connect/token`;

let cached: { token: string; expires: number } | null = null;

// Every instance seeds and signs in against the one Keycloak, so a single timeout or 503 there is a blip, not
// an outage. Each call rides out a few of them before the office is told sign-in is unavailable.
async function call(url: string, init: RequestInit): Promise<Response> {
  let why = "unknown";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resume) => setTimeout(resume, BACKOFF_MS[attempt - 1] ?? 500));
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status < 502 || response.status > 504) return response;
      why = `HTTP ${response.status}`;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      why = cause instanceof Error ? `${cause.name} ${(cause as { code?: string }).code ?? ""} ${cause.message}` : "unknown";
    }
  }
  console.error("keycloak call failed:", why);
  throw new KeycloakUnavailable("Keycloak cannot be reached");
}

async function adminToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  const response = await call(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.authClientId,
      client_secret: config.authClientSecret,
    }),
  });
  if (response.status !== 200) throw new KeycloakUnavailable("Keycloak refused the service account");
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: Date.now() + Math.max(body.expires_in - 15, 5) * 1000 };
  return body.access_token;
}

async function adminCall(method: string, path: string, body?: unknown): Promise<Response> {
  const token = await adminToken();
  const response = await call(`${admin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) cached = null;
  if (response.status >= 500 || response.status === 401) throw new KeycloakUnavailable("Keycloak answered with an error");
  return response;
}

function usernameOf(handle: string): string {
  return `${config.officeKey}.${handle}`;
}

interface NewUser {
  handle: string;
  fullName: string;
  password: string;
  enabled: boolean;
}

/** Creates the office user; `exists` is a lost race, never a second user. */
export async function createUser(user: NewUser): Promise<"created" | "exists"> {
  const words = user.fullName.trim().split(/\s+/);
  const first = words[0] ?? user.fullName;
  const last = words.length > 1 ? words.slice(1).join(" ") : first;
  const response = await adminCall("POST", "/users", {
    username: usernameOf(user.handle),
    enabled: user.enabled,
    emailVerified: true,
    firstName: first,
    lastName: last,
    email: `${usernameOf(user.handle)}@people.lockset.example`,
    credentials: [{ type: "password", value: user.password, temporary: false }],
  });
  if (response.status === 201) return "created";
  if (response.status === 409) return "exists";
  throw new KeycloakUnavailable(`Keycloak refused the user (${response.status})`);
}

export async function findUserId(handle: string): Promise<string | null> {
  const response = await adminCall("GET", `/users?username=${encodeURIComponent(usernameOf(handle))}&exact=true`);
  if (response.status !== 200) throw new KeycloakUnavailable("Keycloak could not search users");
  const found = (await response.json()) as Array<{ id: string; username: string }>;
  return found.find((user) => user.username === usernameOf(handle))?.id ?? null;
}

export async function setEnabled(handle: string, enabled: boolean): Promise<void> {
  const id = await findUserId(handle);
  if (!id) return;
  const response = await adminCall("PUT", `/users/${id}`, { enabled });
  if (response.status !== 204) throw new KeycloakUnavailable("Keycloak could not update the user");
  if (!enabled) await adminCall("POST", `/users/${id}/logout`);
}

type Grant = "ok" | "bad_credentials" | "account_disabled";

export async function passwordGrant(handle: string, password: string): Promise<Grant> {
  const response = await call(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: config.authClientId,
      client_secret: config.authClientSecret,
      username: usernameOf(handle),
      password,
    }),
  });
  if (response.status === 200) {
    const body = (await response.json()) as { refresh_token?: string };
    if (body.refresh_token) {
      await call(`${config.authIssuerUrl}/protocol/openid-connect/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.authClientId,
          client_secret: config.authClientSecret,
          refresh_token: body.refresh_token,
        }),
      }).catch(() => undefined);
    }
    return "ok";
  }
  if (response.status >= 500) throw new KeycloakUnavailable("Keycloak answered with an error");
  const body = (await response.json().catch(() => ({}))) as { error_description?: string };
  if (/disabled/i.test(body.error_description ?? "")) return "account_disabled";
  return "bad_credentials";
}
