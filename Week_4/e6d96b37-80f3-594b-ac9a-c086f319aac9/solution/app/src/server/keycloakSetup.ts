// Run-time Keycloak configuration through the app's service account: realm roles, the
// flan_namespace user attribute, the one-time-code step-up level, and each namespace's identities.

import { randomInt } from "node:crypto";
import { config } from "./config.js";
import { exclusively } from "./db.js";
import { serviceUnavailable } from "./errors.js";
import { ACR, admin, adminJson, findUser } from "./keycloak.js";
import type { Role } from "../shared/types.js";

const FLOW = "flan-step-up-browser";
const LEVELS = "flan-levels";
const LEVEL_FLOWS = [
  { alias: "flan-level-1", level: 1, maxAge: 36000, authenticator: "auth-username-password-form" },
  { alias: "flan-level-2", level: 2, maxAge: 0, authenticator: "auth-otp-form" },
] as const;
export const REALM_ROLES = { dealer: "flan-dealer", counterpart: "flan-counterpart" } as const;
const ATTRIBUTE = "flan_namespace";

interface ExecutionInfo {
  id: string;
  providerId?: string;
  displayName: string;
  requirement: string;
  level: number;
  authenticationFlow?: boolean;
  flowId?: string;
}

async function ok(reply: Promise<Response>, ...accepted: number[]): Promise<Response> {
  const response = await reply;
  if (!response.ok && !accepted.includes(response.status)) throw serviceUnavailable();
  return response;
}

const executions = (alias: string) => adminJson<ExecutionInfo[]>("GET", `/authentication/flows/${alias}/executions`);

async function setRequirement(parent: string, id: string, requirement: string): Promise<void> {
  await ok(admin("PUT", `/authentication/flows/${parent}/executions`, { id, requirement }));
}

async function addExecution(parent: string, provider: string, requirement: string): Promise<string> {
  const before = new Set((await executions(parent)).map((e) => e.id));
  await ok(admin("POST", `/authentication/flows/${parent}/executions/execution`, { provider }));
  const added = (await executions(parent)).find((e) => !before.has(e.id) && e.providerId === provider);
  if (!added) throw serviceUnavailable();
  await setRequirement(parent, added.id, requirement);
  return added.id;
}

async function addSubflow(parent: string, alias: string, requirement: string): Promise<void> {
  await ok(admin("POST", `/authentication/flows/${parent}/executions/flow`, {
    alias,
    type: "basic-flow",
    provider: "registration-page-form",
    description: alias,
  }));
  const added = (await executions(parent)).find((e) => e.displayName === alias);
  if (!added) throw serviceUnavailable();
  await setRequirement(parent, added.id, requirement);
}

/** The step-up browser flow: cookie, or level 1 (password) then level 2 (one-time code, never remembered). */
async function ensureFlow(): Promise<void> {
  const flows = await adminJson<{ id: string; alias: string }[]>("GET", "/authentication/flows");
  const existing = flows.find((f) => f.alias === FLOW);
  if (existing) {
    const steps = await executions(FLOW);
    const complete = LEVEL_FLOWS.every((l) => steps.some((s) => s.providerId === l.authenticator));
    if (complete) return;
    await ok(admin("DELETE", `/authentication/flows/${existing.id}`));
  }
  await ok(admin("POST", "/authentication/flows", {
    alias: FLOW,
    description: "Browser sign-in with a one-time-code step-up level",
    providerId: "basic-flow",
    topLevel: true,
    builtIn: false,
  }));
  await addExecution(FLOW, "auth-cookie", "ALTERNATIVE");
  await addSubflow(FLOW, LEVELS, "ALTERNATIVE");
  for (const level of LEVEL_FLOWS) {
    await addSubflow(LEVELS, level.alias, "CONDITIONAL");
    const condition = await addExecution(level.alias, "conditional-level-of-authentication", "REQUIRED");
    await ok(admin("POST", `/authentication/executions/${condition}/config`, {
      alias: `${level.alias}-condition`,
      config: { "loa-condition-level": String(level.level), "loa-max-age": String(level.maxAge) },
    }));
    await addExecution(level.alias, level.authenticator, "REQUIRED");
  }
}

async function ensureProfileAttribute(): Promise<void> {
  const profile = await adminJson<{ attributes: { name: string }[] } & Record<string, unknown>>("GET", "/users/profile");
  if (profile.attributes.some((a) => a.name === ATTRIBUTE)) return;
  profile.attributes.push({
    name: ATTRIBUTE,
    displayName: "Flan namespace",
    permissions: { view: ["admin"], edit: ["admin"] },
    multivalued: false,
    validations: {},
    annotations: {},
  } as { name: string });
  await ok(admin("PUT", "/users/profile", profile));
}

let realmReady: Promise<void> | null = null;

/** Idempotent realm configuration, applied once per process (serialised across instances) and retried after a failure. */
export function configureRealm(): Promise<void> {
  realmReady ??= exclusively("flan-realm", applyRealm).catch((error: unknown) => {
    realmReady = null;
    throw error;
  });
  return realmReady;
}

async function applyRealm(): Promise<void> {
  for (const role of Object.values(REALM_ROLES)) {
    await ok(admin("POST", "/roles", { name: role }), 409);
  }
  await ensureProfileAttribute();
  await ensureFlow();
  await ok(admin("PUT", "", {
    browserFlow: FLOW,
    otpPolicyType: "totp",
    otpPolicyAlgorithm: "HmacSHA1",
    otpPolicyDigits: 6,
    otpPolicyPeriod: config.limits.FLAN_TOTP_PERIOD_S,
    otpPolicyLookAheadWindow: 1,
    otpPolicyCodeReusable: true,
    attributes: { "acr.loa.map": JSON.stringify({ [ACR.password]: 1, [ACR.otp]: 2 }) },
  }));
}

const PEOPLE: Record<Role, { firstName: string; lastName: string }> = {
  dealer: { firstName: "Wren", lastName: "Halloway" },
  counterpart: { firstName: "Odile", lastName: "Marsh" },
  outsider: { firstName: "Penn", lastName: "Ostrander" },
};

export const username = (ns: string, role: Role) => `${ns}-${role}`;
export const password = (ns: string, role: Role) => `Flan-${ns}-${role}`;

function totpSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from({ length: 20 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Creates (or recreates) one seeded identity with its password and one-time-code credential. */
export async function provisionIdentity(ns: string, role: Role): Promise<string> {
  const name = username(ns, role);
  const existing = await findUser(name);
  if (existing) await ok(admin("DELETE", `/users/${existing.id}`), 404);
  const secret = totpSecret();
  const created = await ok(admin("POST", "/users", {
    username: name,
    enabled: true,
    email: `${name}@flan.invalid`,
    emailVerified: true,
    ...PEOPLE[role],
    attributes: { [ATTRIBUTE]: [ns] },
    requiredActions: [],
    credentials: [
      { type: "password", value: password(ns, role), temporary: false },
      {
        type: "otp",
        userLabel: "Flan desk",
        secretData: JSON.stringify({ value: secret }),
        credentialData: JSON.stringify({
          subType: "totp",
          digits: 6,
          counter: 0,
          period: config.limits.FLAN_TOTP_PERIOD_S,
          algorithm: "HmacSHA1",
        }),
      },
    ],
  }));
  const id = created.headers.get("location")?.split("/").pop();
  if (!id) throw serviceUnavailable();
  if (role !== "outsider") {
    const realmRole = await adminJson<unknown>("GET", `/roles/${REALM_ROLES[role]}`);
    await ok(admin("POST", `/users/${id}/role-mappings/realm`, [realmRole]));
  }
  return secret;
}

/** The namespace a signed-in Keycloak user belongs to, from their flan_namespace attribute. */
export async function namespaceOf(userId: string): Promise<string | null> {
  const user = await adminJson<{ attributes?: Record<string, string[]> }>("GET", `/users/${userId}`);
  return user.attributes?.[ATTRIBUTE]?.[0] ?? null;
}
