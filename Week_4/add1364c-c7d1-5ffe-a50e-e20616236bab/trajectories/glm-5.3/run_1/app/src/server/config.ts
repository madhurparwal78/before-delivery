export type Role = 'office_manager' | 'managing_partner' | 'staff_accountant' | 'outside_bookkeeper';

export interface Settings {
  databaseUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  authIssuerUrl: string;
  authClientId: string;
  authClientSecret: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  wiremockUrl: string;
  officeKey: string;
  locksetSecretKey: string | null;
  clockStart: Date | null;
  revealSessionSeconds: number;
  breachCheckSeconds: number;
  signInLockSeconds: number;
  port: number;
}

function readInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const locksetSecretKey = env.LOCKSET_SECRET_KEY ?? null;
  const clockStartRaw = env.LOCKSET_CLOCK_START;
  const clockStart = clockStartRaw ? new Date(clockStartRaw) : null;
  return {
    databaseUrl: env.DATABASE_URL ?? '',
    keycloakUrl: env.KEYCLOAK_URL ?? '',
    keycloakRealm: env.KEYCLOAK_REALM ?? '',
    authIssuerUrl: env.AUTH_ISSUER_URL ?? '',
    authClientId: env.AUTH_CLIENT_ID ?? '',
    authClientSecret: env.AUTH_CLIENT_SECRET ?? '',
    killbillUrl: env.KILLBILL_URL ?? '',
    killbillUsername: env.KILLBILL_USERNAME ?? '',
    killbillPassword: env.KILLBILL_PASSWORD ?? '',
    killbillApiKey: env.KILLBILL_API_KEY ?? '',
    killbillApiSecret: env.KILLBILL_API_SECRET ?? '',
    wiremockUrl: env.WIREMOCK_URL ?? '',
    officeKey: env.OFFICE_KEY ?? 'bl',
    locksetSecretKey,
    clockStart: clockStart !== null && !Number.isNaN(clockStart.getTime()) ? clockStart : null,
    revealSessionSeconds: readInt(env.REVEAL_SESSION_SECONDS, 28800),
    breachCheckSeconds: readInt(env.BREACH_CHECK_SECONDS, 60),
    signInLockSeconds: readInt(env.SIGN_IN_LOCK_SECONDS, 900),
    port: readInt(env.APP_PUBLIC_PORT, 4173)
  };
}
