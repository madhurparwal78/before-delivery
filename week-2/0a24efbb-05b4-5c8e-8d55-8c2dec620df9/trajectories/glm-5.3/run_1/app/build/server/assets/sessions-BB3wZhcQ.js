import { createHash } from "node:crypto";
import { query } from "./pg-C3ev9-Vg.js";
import "pg";
function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return dflt;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}
const config = {
  databaseUrl: process.env.DATABASE_URL,
  authIssuerUrl: process.env.AUTH_ISSUER_URL,
  keycloakUrl: process.env.KEYCLOAK_URL,
  keycloakRealm: process.env.KEYCLOAK_REALM,
  authClientId: process.env.AUTH_CLIENT_ID,
  authClientSecret: process.env.AUTH_CLIENT_SECRET,
  publicPort: intEnv("APP_PUBLIC_PORT", 4173),
  publicUrl: process.env.APP_PUBLIC_URL || `http://127.0.0.1:${intEnv("APP_PUBLIC_PORT", 4173)}`,
  signInWindowSeconds: intEnv("SIGN_IN_WINDOW_SECONDS", 900),
  signInLockoutSeconds: intEnv("SIGN_IN_LOCKOUT_SECONDS", 900),
  sessionIdleSeconds: intEnv("SESSION_IDLE_SECONDS", 1800),
  sessionMaxSeconds: intEnv("SESSION_MAX_SECONDS", 43200),
  shareLinkTtlSeconds: intEnv("SHARE_LINK_TTL_SECONDS", 604800),
  shareLinkMints: intEnv("SHARE_LINK_MINTS", 10),
  shareLinkMintWindowMinutes: intEnv("SHARE_LINK_MINT_WINDOW_MINUTES", 15),
  employerSeededOn: process.env.EMPLOYER_SEEDED_ON
};
function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
const SESSION_COOKIE = "rostara_session";
async function loadSession(token) {
  if (!token) return null;
  const rows = await query(
    `SELECT s.id, s.token_hash, s.created_at, s.last_used_at, s.ended_at, s.ended_reason,
            p.id AS person_id, p.name, p.work_address, p.role, p.active
     FROM desk_session s JOIN person p ON p.id = s.person_id
     WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  if (rows.length === 0) return { kind: "unknown" };
  const row = rows[0];
  if (row.ended_at) {
    return row.ended_reason === "signed_out" ? { kind: "unknown" } : { kind: "ended" };
  }
  const now = Date.now();
  const idleLimit = config.sessionIdleSeconds * 1e3;
  const maxLimit = config.sessionMaxSeconds * 1e3;
  if (now - row.last_used_at.getTime() >= idleLimit) return { kind: "ended" };
  if (now - row.created_at.getTime() >= maxLimit) return { kind: "ended" };
  if (!row.active) return { kind: "ended" };
  return {
    kind: "ok",
    session: row,
    person: {
      id: row.person_id,
      name: row.name,
      work_address: row.work_address,
      role: row.role,
      active: row.active
    }
  };
}
async function touchSession(sessionId) {
  await query("UPDATE desk_session SET last_used_at = now() WHERE id = $1", [sessionId]);
}
export {
  SESSION_COOKIE,
  hashToken,
  loadSession,
  touchSession
};
