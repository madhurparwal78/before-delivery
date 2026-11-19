// Sign-in through Keycloak's own pages: login, the callback, the one-time-code step-up and logout.
// A half-completed sign-in grants nothing; the session cookie is set only after the code exchange.

import { randomBytes } from "node:crypto";
import { query } from "./db.js";
import { ACR, authorizeUrl, exchangeCode, pkcePair, reachable } from "./keycloak.js";
import { REALM_ROLES, namespaceOf } from "./keycloakSetup.js";
import { createSession, readSession, sessionCookie, type Session } from "./sessions.js";
import type { Role } from "../shared/types.js";

export type AuthOutcome = { redirect: string; cookie?: string } | { signInDown: true };

/** Only same-origin paths are accepted as a return target. */
export function safeReturn(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

async function begin(kind: "login" | "step-up", returnTo: string, session: Session | null): Promise<AuthOutcome> {
  if (!(await reachable())) return { signInDown: true };
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  await query(
    "INSERT INTO sign_in_requests (state, kind, return_to, verifier, session_id, requested_at) VALUES ($1,$2,$3,$4,$5,now())",
    [state, kind, returnTo, verifier, session?.id ?? null],
  );
  return { redirect: authorizeUrl(state, challenge, kind === "login" ? ACR.password : ACR.otp) };
}

export function login(returnTo: string): Promise<AuthOutcome> {
  return begin("login", returnTo, null);
}

export async function stepUp(req: Parameters<typeof readSession>[0], returnTo: string): Promise<AuthOutcome> {
  const session = await readSession(req);
  return session ? begin("step-up", returnTo, session) : begin("login", returnTo, null);
}

function roleOf(roles: string[]): Role {
  if (roles.includes(REALM_ROLES.dealer)) return "dealer";
  if (roles.includes(REALM_ROLES.counterpart)) return "counterpart";
  return "outsider";
}

export async function callback(params: URLSearchParams): Promise<AuthOutcome> {
  const state = params.get("state");
  const rows = state
    ? await query<{ kind: string; return_to: string; verifier: string; session_id: string | null; requested_at: Date }>(
        "DELETE FROM sign_in_requests WHERE state = $1 RETURNING kind, return_to, verifier, session_id, requested_at",
        [state],
      )
    : [];
  const request = rows[0];
  if (!request) return { redirect: "/" };
  const code = params.get("code");
  if (!code) return { redirect: request.return_to };
  const signedIn = await exchangeCode(code, request.verifier);
  if (request.kind === "step-up" && request.session_id) {
    if (signedIn.acr === ACR.otp) {
      const authTime = signedIn.authTime * 1000 >= request.requested_at.getTime() - 1000 ? signedIn.authTime : signedIn.issuedAt;
      await query(
        "UPDATE app_sessions SET step_up_at = to_timestamp($2), keycloak_session = $3 WHERE id = $1 AND subject = $4",
        [request.session_id, authTime, signedIn.keycloakSession, signedIn.subject],
      );
    }
    return { redirect: request.return_to };
  }
  const ns = (await namespaceOf(signedIn.subject)) ?? "";
  const id = await createSession({
    ns,
    subject: signedIn.subject,
    username: signedIn.username,
    role: roleOf(signedIn.roles),
    keycloak_session: signedIn.keycloakSession,
  });
  return { redirect: request.return_to, cookie: sessionCookie(id) };
}
