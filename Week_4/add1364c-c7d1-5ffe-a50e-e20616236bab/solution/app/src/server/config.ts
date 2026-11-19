import { createHash } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

const clientSecret = required("AUTH_CLIENT_SECRET");
const keyHex = process.env.LOCKSET_SECRET_KEY;
const officeKey = process.env.OFFICE_KEY || "bl";
if (!/^[a-z]{2,8}$/.test(officeKey)) throw new Error("OFFICE_KEY must be 2 to 8 lowercase letters");

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  keycloakUrl: required("KEYCLOAK_URL").replace(/\/+$/, ""),
  keycloakRealm: required("KEYCLOAK_REALM"),
  authIssuerUrl: required("AUTH_ISSUER_URL").replace(/\/+$/, ""),
  authClientId: required("AUTH_CLIENT_ID"),
  authClientSecret: clientSecret,
  killbillUrl: required("KILLBILL_URL").replace(/\/+$/, ""),
  killbillUsername: required("KILLBILL_USERNAME"),
  killbillPassword: required("KILLBILL_PASSWORD"),
  killbillApiKey: required("KILLBILL_API_KEY"),
  killbillApiSecret: required("KILLBILL_API_SECRET"),
  wiremockUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
  officeKey,
  secretKey:
    keyHex && /^[0-9a-fA-F]{64}$/.test(keyHex)
      ? Buffer.from(keyHex, "hex")
      : createHash("sha256").update(`lockset-secret-key:${clientSecret}`).digest(),
  clockStart: process.env.LOCKSET_CLOCK_START || null,
  revealSessionSeconds: whole("REVEAL_SESSION_SECONDS", 28800),
  breachCheckSeconds: whole("BREACH_CHECK_SECONDS", 60),
  signInLockSeconds: whole("SIGN_IN_LOCK_SECONDS", 900),
};
