function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  authIssuerUrl: process.env.AUTH_ISSUER_URL,
  keycloakUrl: process.env.KEYCLOAK_URL,
  keycloakRealm: process.env.KEYCLOAK_REALM,
  authClientId: process.env.AUTH_CLIENT_ID,
  authClientSecret: process.env.AUTH_CLIENT_SECRET,
  publicPort: intEnv('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL || `http://127.0.0.1:${intEnv('APP_PUBLIC_PORT', 4173)}`,
  signInWindowSeconds: intEnv('SIGN_IN_WINDOW_SECONDS', 900),
  signInLockoutSeconds: intEnv('SIGN_IN_LOCKOUT_SECONDS', 900),
  sessionIdleSeconds: intEnv('SESSION_IDLE_SECONDS', 1800),
  sessionMaxSeconds: intEnv('SESSION_MAX_SECONDS', 43200),
  shareLinkTtlSeconds: intEnv('SHARE_LINK_TTL_SECONDS', 604800),
  shareLinkMints: intEnv('SHARE_LINK_MINTS', 10),
  shareLinkMintWindowMinutes: intEnv('SHARE_LINK_MINT_WINDOW_MINUTES', 15),
  employerSeededOn: process.env.EMPLOYER_SEEDED_ON,
};

export const SEEDED_PASSWORD = 'deku-demo-pw-2026';
