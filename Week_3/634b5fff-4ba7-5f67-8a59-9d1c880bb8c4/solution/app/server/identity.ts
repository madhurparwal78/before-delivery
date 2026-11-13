import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { ROLES, type Role } from "../shared/domain.js";
import { config } from "./config.js";

/** Keycloak: staff sign-in by OIDC, token verification, and idempotent provisioning of roles and staff. */

export class IdentityUnreachable extends Error {
  constructor() {
    super("identity unreachable");
  }
}

const REALM = (): string => `${config.keycloak.url}/realms/${config.keycloak.realm}`;
const ADMIN = (): string => `${config.keycloak.url}/admin/realms/${config.keycloak.realm}`;

const send = async (url: string, init: RequestInit): Promise<Response> => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (response.status >= 500) throw new IdentityUnreachable();
    return response;
  } catch {
    throw new IdentityUnreachable();
  }
};

const tokenRequest = async (form: Record<string, string>): Promise<Record<string, unknown> | null> => {
  const response = await send(`${REALM()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.keycloak.clientId, client_secret: config.keycloak.clientSecret, ...form }),
  });
  return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
};

export const authorizationUrl = (redirectUri: string, state: string): string =>
  `${config.keycloak.issuer}/protocol/openid-connect/auth?${new URLSearchParams({
    client_id: config.keycloak.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid", state,
  })}`;

export const exchangeCode = async (code: string, redirectUri: string): Promise<string | null> => {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return typeof tokens?.access_token === "string" ? tokens.access_token : null;
};

/** Succeeds only when the identity service answers; used before a sign-in redirect. */
export const assertReachable = async (): Promise<void> => {
  await send(`${REALM()}/.well-known/openid-configuration`, { method: "GET" });
};

let keys: Map<string, JsonWebKey> = new Map();

const refreshKeys = async (): Promise<void> => {
  const response = await send(`${REALM()}/protocol/openid-connect/certs`, { method: "GET" });
  const body = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
  keys = new Map(body.keys.map((key) => [key.kid, key]));
};

export interface Principal {
  username: string;
  roles: Role[];
}

const decodePart = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

/** Verifies a Keycloak access token's signature, issuer and expiry; null when it is not valid. */
export const verifyAccessToken = async (token: string): Promise<Principal | null> => {
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  try {
    const header = decodePart(head);
    const claims = decodePart(body);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    if (!keys.has(header.kid)) await refreshKeys();
    const jwk = keys.get(header.kid);
    if (!jwk) return null;
    const valid = verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
    const expires = typeof claims.exp === "number" ? claims.exp : 0;
    if (!valid || claims.iss !== config.keycloak.issuer || expires * 1000 < Date.now()) return null;
    return { username: String(claims.preferred_username ?? ""), roles: rolesOf(claims) };
  } catch {
    return null;
  }
};

const rolesOf = (claims: Record<string, unknown>): Role[] => {
  const access = claims.realm_access as { roles?: string[] } | undefined;
  return ROLES.filter((role) => access?.roles?.includes(role));
};

const serviceToken = async (): Promise<string> => {
  const tokens = await tokenRequest({ grant_type: "client_credentials" });
  if (typeof tokens?.access_token !== "string") throw new IdentityUnreachable();
  return tokens.access_token;
};

/** Creates the realm roles and the seeded staff when they are missing, and gives each their role. */
export const provision = async (): Promise<void> => {
  const authorization = { authorization: `Bearer ${await serviceToken()}`, "content-type": "application/json" };
  const json = async (path: string, init: RequestInit = {}): Promise<Response> =>
    send(`${ADMIN()}${path}`, { ...init, headers: { ...authorization, ...(init.headers ?? {}) } });
  for (const role of ROLES) {
    const existing = await json(`/roles/${role}`);
    if (existing.status === 404) await json("/roles", { method: "POST", body: JSON.stringify({ name: role }) });
  }
  for (const staff of config.staffSeeds) {
    const found = (await (await json(`/users?username=${staff.username}&exact=true`)).json()) as { id: string }[];
    let id = found[0]?.id;
    if (!id) {
      const created = await json("/users", {
        method: "POST",
        body: JSON.stringify({
          username: staff.username, enabled: true, emailVerified: true, firstName: staff.username, lastName: "Press",
          email: `${staff.username}@svovlstik.example`,
          credentials: [{ type: "password", value: staff.password, temporary: false }],
        }),
      });
      id = created.headers.get("location")?.split("/").at(-1);
    }
    if (!id) throw new IdentityUnreachable();
    const role = (await (await json(`/roles/${staff.role}`)).json()) as { id: string; name: string };
    await json(`/users/${id}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });
  }
};
