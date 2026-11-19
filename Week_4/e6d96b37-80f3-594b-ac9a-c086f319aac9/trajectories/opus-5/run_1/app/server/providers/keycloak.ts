import { createHmac, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import { limits, providers } from '../config.ts';
import { serviceUnavailable } from '../http/errors.ts';
import type { Role } from '../../shared/types.ts';

/**
 * Keycloak handles sign-in and the one-time-code step-up level. The realm's
 * step-up flow and the seeded identities are configured idempotently on serve
 * through the app's own service account; no provisioned file is edited.
 */

const { url, realm, issuerUrl, clientId, clientSecret } = providers.keycloak;
const adminBase = `${url}/admin/realms/${realm}`;

/** Raised when Keycloak itself cannot be reached, so sign-in shows F_SIGNIN_DOWN. */
export class KeycloakDown extends Error {
  constructor() {
    super('keycloak unreachable');
    this.name = 'KeycloakDown';
  }
}

async function timedFetch(target: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.providerTimeoutMs);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch {
    throw new KeycloakDown();
  } finally {
    clearTimeout(timer);
  }
}

/* -- service account ---------------------------------------------------- */

let adminToken: { value: string; expiresAt: number } | null = null;

async function serviceToken(): Promise<string> {
  const now = Date.now();
  if (adminToken && adminToken.expiresAt > now + 5_000) return adminToken.value;
  const reply = await timedFetch(`${issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!reply.ok) throw new KeycloakDown();
  const body = (await reply.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== 'string') throw new KeycloakDown();
  adminToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 60) * 1000,
  };
  return adminToken.value;
}

async function admin(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const token = await serviceToken();
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let payload: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(init.body);
  }
  return timedFetch(`${adminBase}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: payload,
  });
}

async function adminJson<T>(path: string): Promise<T> {
  const reply = await admin(path);
  if (!reply.ok) throw new KeycloakDown();
  return (await reply.json()) as T;
}

/* -- realm step-up configuration ---------------------------------------- */

const BROWSER_FLOW = 'flan browser';

/**
 * The step-up level is driven by this user attribute. The app sets it just
 * before sending the browser to Keycloak for a one-time code and clears it
 * again on the way back, so an ordinary password sign-in stays level 1 and only
 * a step-up reaches Keycloak's one-time-code challenge.
 */
export const STEP_UP_ATTRIBUTE = 'flan_step_up';
export const STEP_UP_ATTRIBUTE_VALUE = 'requested';

interface FlowSummary {
  id: string;
  alias: string;
}

interface ExecutionSummary {
  id: string;
  displayName?: string;
  providerId?: string | null;
  requirement?: string;
  level?: number;
  index?: number;
  flowId?: string;
  authenticationFlow?: boolean;
  authenticationConfig?: string;
}

async function findFlow(alias: string): Promise<FlowSummary | null> {
  const flows = await adminJson<FlowSummary[]>('/authentication/flows');
  return flows.find((flow) => flow.alias === alias) ?? null;
}

async function executionsOf(alias: string): Promise<ExecutionSummary[]> {
  return adminJson<ExecutionSummary[]>(
    `/authentication/flows/${encodeURIComponent(alias)}/executions`,
  );
}

async function setRequirement(
  alias: string,
  execution: ExecutionSummary,
  requirement: string,
): Promise<void> {
  await admin(`/authentication/flows/${encodeURIComponent(alias)}/executions`, {
    method: 'PUT',
    body: { ...execution, requirement },
  });
}

/**
 * Builds the realm's browser flow as a copy of the built-in `browser` flow with
 * one change: the conditional OTP subflow inside `forms` is gated on the
 * step-up attribute instead of on "user configured".
 *
 *   Cookie                        ALTERNATIVE
 *   Identity Provider Redirector  ALTERNATIVE
 *   <copy> forms                  ALTERNATIVE
 *     Username Password Form      REQUIRED
 *     <copy> Conditional OTP      CONDITIONAL
 *       Condition - user attribute  REQUIRED   (flan_step_up == requested)
 *       OTP Form                    REQUIRED
 *
 * So a password alone is level 1, and the one-time-code page is reached only
 * while the app has marked a step-up as requested. The subflow has to live
 * inside `forms`: Keycloak resolves a flow's conditions before running that
 * flow's authenticators, and a sibling that resolves to required would suppress
 * the alternative identity group, so the condition can only be asked once the
 * password form has established who is signing in.
 */
export async function rebuildStepUpFlow(): Promise<void> {
  const existing = await findFlow(BROWSER_FLOW);
  if (existing) {
    const current = await adminJson<{ realm: string; browserFlow?: string }>('');
    if (current.browserFlow === BROWSER_FLOW) {
      await admin('', { method: 'PUT', body: { realm: current.realm, browserFlow: 'browser' } });
    }
    await admin(`/authentication/flows/${existing.id}`, { method: 'DELETE' });
  }

  const copied = await admin('/authentication/flows/browser/copy', {
    method: 'POST',
    body: { newName: BROWSER_FLOW },
  });
  if (!copied.ok) throw new KeycloakDown();

  const topLevel = await executionsOf(BROWSER_FLOW);
  const formsRow = topLevel.find((execution) => execution.displayName?.endsWith(' forms'));
  const otpRow = topLevel.find((execution) =>
    execution.displayName?.endsWith('Browser - Conditional OTP'),
  );
  if (!formsRow?.flowId || !otpRow?.flowId) throw new KeycloakDown();
  const formsAlias = (await adminJson<{ alias: string }>(`/authentication/flows/${formsRow.flowId}`))
    .alias;
  const otpAlias = (await adminJson<{ alias: string }>(`/authentication/flows/${otpRow.flowId}`))
    .alias;

  for (const execution of await executionsOf(otpAlias)) {
    if (execution.providerId === 'conditional-user-configured') {
      await admin(`/authentication/executions/${execution.id}`, { method: 'DELETE' });
    }
  }
  await admin(`/authentication/flows/${encodeURIComponent(otpAlias)}/executions/execution`, {
    method: 'POST',
    body: { provider: 'conditional-user-attribute' },
  });

  for (const execution of await executionsOf(otpAlias)) {
    if (execution.providerId === 'conditional-user-attribute') {
      await setRequirement(otpAlias, execution, 'REQUIRED');
      const config = await admin(`/authentication/executions/${execution.id}/config`, {
        method: 'POST',
        body: {
          alias: 'flan-step-up-requested',
          config: {
            attribute_name: STEP_UP_ATTRIBUTE,
            attribute_expected_value: STEP_UP_ATTRIBUTE_VALUE,
            include_group_attributes: 'false',
            not: 'false',
            regex: 'false',
          },
        },
      });
      if (!config.ok) throw new KeycloakDown();
    }
  }
  // The condition has to be asked before the code is collected.
  await orderFirst(otpAlias, (execution) => execution.providerId === 'conditional-user-attribute');

  // Re-asserting the subflow's requirement resets its priority, so its place
  // after the password form is restored afterwards: the condition needs a user,
  // and only the password form establishes one.
  for (const execution of await executionsOf(formsAlias)) {
    if (execution.displayName === otpAlias) {
      await setRequirement(formsAlias, execution, 'CONDITIONAL');
    }
  }
  await orderLast(formsAlias, (execution) => execution.displayName === otpAlias);
}

/** Moves the matching execution to the top of its flow. */
async function orderFirst(
  alias: string,
  match: (execution: ExecutionSummary) => boolean,
): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    const rows = (await executionsOf(alias)).filter((row) => row.level === 0);
    const at = rows.findIndex(match);
    if (at <= 0) return;
    const row = rows[at];
    if (!row) return;
    await admin(`/authentication/executions/${row.id}/raise-priority`, { method: 'POST' });
  }
}

/** Moves the matching execution to the bottom of its flow. */
async function orderLast(
  alias: string,
  match: (execution: ExecutionSummary) => boolean,
): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    const rows = (await executionsOf(alias)).filter((row) => row.level === 0);
    const at = rows.findIndex(match);
    if (at < 0 || at === rows.length - 1) return;
    const row = rows[at];
    if (!row) return;
    await admin(`/authentication/executions/${row.id}/lower-priority`, { method: 'POST' });
  }
}

async function ensureBrowserFlow(): Promise<void> {
  const flow = await findFlow(BROWSER_FLOW);
  const current = await adminJson<{ realm: string; browserFlow?: string }>('');
  if (!flow) {
    await rebuildStepUpFlow();
  }
  if (current.browserFlow !== BROWSER_FLOW) {
    const reply = await admin('', {
      method: 'PUT',
      body: {
        realm: current.realm,
        browserFlow: BROWSER_FLOW,
        otpPolicyPeriod: limits.totpPeriodS,
      },
    });
    if (!reply.ok) throw new KeycloakDown();
  }
}

/**
 * Updates one user without disturbing anything else about them. A partial PUT
 * clears the realm's managed profile fields, which would leave the account
 * incomplete and send the next sign-in to Keycloak's "verify profile" page, so
 * the current representation is always carried through.
 */
async function patchUser(subject: string, change: Partial<KcUser>): Promise<void> {
  const reply = await admin(`/users/${encodeURIComponent(subject)}`);
  if (!reply.ok) {
    await reply.arrayBuffer().catch(() => undefined);
    throw new KeycloakDown();
  }
  const current = (await reply.json()) as KcUser & Record<string, unknown>;
  const updated = await admin(`/users/${encodeURIComponent(subject)}`, {
    method: 'PUT',
    body: { ...current, ...change },
  });
  if (!updated.ok) throw new KeycloakDown();
}

/** The step-up marker is a plain user attribute, kept out of the user profile. */
async function setStepUpAttribute(subject: string, requested: boolean): Promise<void> {
  const reply = await admin(`/users/${encodeURIComponent(subject)}`);
  if (!reply.ok) {
    await reply.arrayBuffer().catch(() => undefined);
    throw new KeycloakDown();
  }
  const user = (await reply.json()) as KcUser;
  const attributes = { ...(user.attributes ?? {}) };
  if (requested) {
    attributes[STEP_UP_ATTRIBUTE] = [STEP_UP_ATTRIBUTE_VALUE];
  } else {
    delete attributes[STEP_UP_ATTRIBUTE];
  }
  await patchUser(subject, { attributes });
}

export const requestStepUpChallenge = (subject: string): Promise<void> =>
  setStepUpAttribute(subject, true);

export const clearStepUpChallenge = (subject: string): Promise<void> =>
  setStepUpAttribute(subject, false);

export async function isStepUpChallengePending(subject: string): Promise<boolean> {
  const reply = await admin(`/users/${encodeURIComponent(subject)}`);
  if (!reply.ok) {
    await reply.arrayBuffer().catch(() => undefined);
    throw new KeycloakDown();
  }
  const user = (await reply.json()) as KcUser;
  return user.attributes?.[STEP_UP_ATTRIBUTE]?.[0] === STEP_UP_ATTRIBUTE_VALUE;
}

interface ProfileAttribute {
  name: string;
  displayName?: string;
  multivalued?: boolean;
  permissions?: { view: string[]; edit: string[] };
  validations?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  required?: unknown;
  selector?: { scopes?: string[] };
}

/**
 * The realm's declarative user profile drops any attribute it does not declare,
 * so the namespace attribute and the step-up marker are declared here as
 * admin-only attributes. Without this they would be silently discarded.
 */
async function ensureUserProfileAttributes(): Promise<void> {
  const profile = await adminJson<{
    attributes?: ProfileAttribute[];
    unmanagedAttributePolicy?: string;
  }>('/users/profile');
  const attributes = [...(profile.attributes ?? [])];
  const wanted: ProfileAttribute[] = [
    {
      name: 'flan_namespace',
      displayName: 'Flan namespace',
      multivalued: false,
      permissions: { view: ['admin'], edit: ['admin'] },
      selector: { scopes: [] },
    },
    {
      name: STEP_UP_ATTRIBUTE,
      displayName: 'Flan step-up requested',
      multivalued: false,
      permissions: { view: ['admin'], edit: ['admin'] },
      selector: { scopes: [] },
    },
  ];

  let changed = false;
  for (const attribute of wanted) {
    if (!attributes.some((declared) => declared.name === attribute.name)) {
      attributes.push(attribute);
      changed = true;
    }
  }
  if (!changed) return;

  const reply = await admin('/users/profile', {
    method: 'PUT',
    body: { ...profile, attributes },
  });
  if (!reply.ok) throw new KeycloakDown();
}

async function ensureRealmRoles(): Promise<void> {
  for (const name of ['flan-dealer', 'flan-counterpart']) {
    const existing = await admin(`/roles/${encodeURIComponent(name)}`);
    if (existing.ok) {
      await existing.arrayBuffer().catch(() => undefined);
      continue;
    }
    await admin('/roles', { method: 'POST', body: { name } });
  }
}

/* -- seeded identities --------------------------------------------------- */

export interface SeedIdentity {
  username: string;
  password: string;
  subject: string;
  totpSecret: string;
  role: Role;
}

const ROLE_OF: Record<Role, string | null> = {
  dealer: 'flan-dealer',
  counterpart: 'flan-counterpart',
  outsider: null,
};

/** A stable per-identity one-time-code secret, so grading can read live codes. */
function totpSecretFor(username: string): string {
  const digest = createHmac('sha256', 'flan-totp').update(username).digest('base64url');
  return digest.slice(0, 32).toUpperCase().replace(/[^A-Z2-7]/g, 'A');
}

interface KcUser {
  id: string;
  username: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

async function findUser(username: string): Promise<KcUser | null> {
  const found = await adminJson<KcUser[]>(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  return found[0] ?? null;
}

export async function ensureIdentity(ns: string, role: Role): Promise<SeedIdentity> {
  const username = `${ns}-${role}`;
  const password = `Flan-${ns}-${role}`;
  const totpSecret = totpSecretFor(username);

  let user = await findUser(username);
  if (user) {
    // A one-time-code credential can only be set as part of creating the user,
    // so an identity that has lost one is rebuilt from scratch.
    const credentials = await adminJson<{ id: string; type: string }[]>(
      `/users/${user.id}/credentials`,
    );
    if (!credentials.some((credential) => credential.type === 'otp')) {
      await admin(`/users/${user.id}`, { method: 'DELETE' });
      user = null;
    }
  }

  if (!user) {
    const created = await admin('/users', {
      method: 'POST',
      body: {
        username,
        enabled: true,
        email: `${username}@flan.invalid`,
        emailVerified: true,
        firstName: role,
        lastName: ns,
        attributes: { flan_namespace: [ns] },
        requiredActions: [],
        credentials: [
          { type: 'password', value: password, temporary: false },
          {
            type: 'otp',
            secretData: JSON.stringify({ value: totpSecret }),
            credentialData: JSON.stringify({
              subType: 'totp',
              digits: 6,
              counter: 0,
              period: limits.totpPeriodS,
              algorithm: 'HmacSHA1',
            }),
          },
        ],
      },
    });
    if (!created.ok && created.status !== 409) throw new KeycloakDown();
    user = await findUser(username);
    if (!user) throw new KeycloakDown();
  } else {
    // A revoked or password-changed identity is restored to its seeded state.
    await admin(`/users/${user.id}`, {
      method: 'PUT',
      body: {
        enabled: true,
        email: `${username}@flan.invalid`,
        emailVerified: true,
        firstName: role,
        lastName: ns,
        attributes: { flan_namespace: [ns] },
        requiredActions: [],
      },
    });
    // The one-time-code credential is already in place and keeps its secret.
    await admin(`/users/${user.id}/reset-password`, {
      method: 'PUT',
      body: { type: 'password', value: password, temporary: false },
    });
  }

  const roleName = ROLE_OF[role];
  if (roleName) {
    const definition = await adminJson<{ id: string; name: string }>(
      `/roles/${encodeURIComponent(roleName)}`,
    );
    await admin(`/users/${user.id}/role-mappings/realm`, {
      method: 'POST',
      body: [{ id: definition.id, name: definition.name }],
    });
  }

  return { username, password, subject: user.id, totpSecret, role };
}

let realmReady = false;

export async function ensureRealm(): Promise<void> {
  if (realmReady) return;
  await ensureUserProfileAttributes();
  await ensureBrowserFlow();
  await ensureRealmRoles();
  realmReady = true;
}

/* -- one-time codes ------------------------------------------------------ */

/**
 * Computes the code Keycloak accepts right now. Keycloak uses the stored secret
 * string's bytes as the HMAC key, so codes follow Keycloak's real clock.
 */
export function currentTotp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / limits.totpPeriodS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8')).update(buffer).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function totpSecretOf(ns: string, role: Role): string {
  return totpSecretFor(`${ns}-${role}`);
}

/* -- authorization code flow -------------------------------------------- */

export interface AuthorizeRequest {
  state: string;
  nonce: string;
  redirectUri: string;
  stepUp: boolean;
  loginHint?: string;
}

export function authorizeUrl(request: AuthorizeRequest): string {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid profile email',
    redirect_uri: request.redirectUri,
    state: request.state,
    nonce: request.nonce,
    acr_values: request.stepUp ? '2' : '1',
  });
  if (request.stepUp) {
    // The step-up level has to re-run the forms leg, because an existing
    // session cookie would otherwise satisfy the flow and skip the code.
    query.set('prompt', 'login');
  }
  if (request.loginHint) query.set('login_hint', request.loginHint);
  return `${issuerUrl}/protocol/openid-connect/auth?${query.toString()}`;
}

export interface IdentityClaims {
  subject: string;
  username: string;
  realmRoles: string[];
  namespaceAttribute: string | null;
  acr: string | null;
  authTimeMs: number | null;
  sessionId: string | null;
}

export interface TokenResult {
  claims: IdentityClaims;
  refreshToken: string | null;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

let jwks: { keys: Jwk[]; fetchedAt: number } | null = null;

async function keySet(forceRefresh: boolean): Promise<Jwk[]> {
  if (!forceRefresh && jwks && Date.now() - jwks.fetchedAt < 300_000) return jwks.keys;
  const reply = await timedFetch(`${issuerUrl}/protocol/openid-connect/certs`, { method: 'GET' });
  if (!reply.ok) throw new KeycloakDown();
  const body = (await reply.json()) as { keys?: Jwk[] };
  jwks = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwks.keys;
}

const ALGORITHMS: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  PS256: 'RSA-SHA256',
  ES256: 'sha256',
};

async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new KeycloakDown();
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8')) as {
    kid?: string;
    alg?: string;
  };
  const algorithm = ALGORITHMS[header.alg ?? 'RS256'];
  if (!algorithm) throw new KeycloakDown();

  for (const refresh of [false, true]) {
    const keys = await keySet(refresh);
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) continue;
    const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    const signed = Buffer.from(`${rawHeader}.${rawPayload}`, 'utf8');
    const signature = Buffer.from(rawSignature, 'base64url');
    const options =
      header.alg === 'PS256'
        ? { key: publicKey, padding: 1 << 5 as never }
        : publicKey;
    if (verifySignature(algorithm, signed, options as never, signature)) {
      const payload = JSON.parse(
        Buffer.from(rawPayload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (payload['iss'] !== issuerUrl) throw new KeycloakDown();
      const expiry = payload['exp'];
      if (typeof expiry === 'number' && expiry * 1000 < Date.now()) throw new KeycloakDown();
      return payload;
    }
  }
  throw new KeycloakDown();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResult> {
  const reply = await timedFetch(`${issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!reply.ok) throw new KeycloakDown();
  const body = (await reply.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
  };
  if (typeof body.id_token !== 'string') throw new KeycloakDown();

  const idClaims = await verifyJwt(body.id_token);
  const accessClaims =
    typeof body.access_token === 'string'
      ? await verifyJwt(body.access_token).catch(() => ({}) as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const realmAccess = accessClaims['realm_access'] as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles)
    ? realmAccess.roles.filter((role): role is string => typeof role === 'string')
    : [];
  const namespaceClaim = idClaims['flan_namespace'] ?? accessClaims['flan_namespace'];
  const authTime = idClaims['auth_time'];

  return {
    claims: {
      subject: String(idClaims['sub'] ?? ''),
      username: String(idClaims['preferred_username'] ?? ''),
      realmRoles: roles,
      namespaceAttribute:
        typeof namespaceClaim === 'string'
          ? namespaceClaim
          : Array.isArray(namespaceClaim) && typeof namespaceClaim[0] === 'string'
            ? namespaceClaim[0]
            : null,
      acr: typeof idClaims['acr'] === 'string' ? idClaims['acr'] : null,
      authTimeMs: typeof authTime === 'number' ? authTime * 1000 : null,
      sessionId: typeof idClaims['sid'] === 'string' ? idClaims['sid'] : null,
    },
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
  };
}

/* -- live account and session checks ------------------------------------ */

/**
 * Every write and every streaming counterpart is re-checked: the account must
 * be enabled and the Keycloak session still active.
 */
export async function isIdentityLive(subject: string, sessionId: string | null): Promise<boolean> {
  const reply = await admin(`/users/${encodeURIComponent(subject)}`);
  if (reply.status === 404) {
    await reply.arrayBuffer().catch(() => undefined);
    return false;
  }
  if (!reply.ok) throw new KeycloakDown();
  const user = (await reply.json()) as KcUser;
  if (user.enabled === false) return false;

  const sessions = await adminJson<{ id: string }[]>(
    `/users/${encodeURIComponent(subject)}/sessions`,
  );
  if (sessions.length === 0) return false;
  if (sessionId === null) return true;
  return sessions.some((session) => session.id === sessionId);
}

export async function lookupNamespaceAttribute(subject: string): Promise<string | null> {
  const reply = await admin(`/users/${encodeURIComponent(subject)}`);
  if (!reply.ok) {
    await reply.arrayBuffer().catch(() => undefined);
    return null;
  }
  const user = (await reply.json()) as KcUser;
  return user.attributes?.['flan_namespace']?.[0] ?? null;
}

/** Grading: disables the user and ends their Keycloak sessions. */
export async function revokeIdentity(username: string): Promise<void> {
  const user = await findUser(username);
  if (!user) throw new KeycloakDown();
  await patchUser(user.id, { enabled: false });
  await admin(`/users/${user.id}/logout`, { method: 'POST' });
}

/** Grading: sets a new password and ends their Keycloak sessions. */
export async function changeIdentityPassword(username: string): Promise<void> {
  const user = await findUser(username);
  if (!user) throw new KeycloakDown();
  await admin(`/users/${user.id}/reset-password`, {
    method: 'PUT',
    body: { type: 'password', value: `Flan-rotated-${randomBytes(8).toString('hex')}`, temporary: false },
  });
  await admin(`/users/${user.id}/logout`, { method: 'POST' });
}

export async function endUserSessions(username: string): Promise<void> {
  const user = await findUser(username);
  if (!user) return;
  await admin(`/users/${user.id}/logout`, { method: 'POST' });
}

/** Any Keycloak outage becomes the published 503 for writes. */
export function asServiceError(error: unknown): never {
  if (error instanceof KeycloakDown) throw serviceUnavailable();
  throw error;
}
