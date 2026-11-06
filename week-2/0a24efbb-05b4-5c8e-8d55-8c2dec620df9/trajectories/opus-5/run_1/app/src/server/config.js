function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  authIssuerUrl: required('AUTH_ISSUER_URL').replace(/\/$/, ''),
  keycloakUrl: required('KEYCLOAK_URL').replace(/\/$/, ''),
  keycloakRealm: required('KEYCLOAK_REALM'),
  authClientId: required('AUTH_CLIENT_ID'),
  authClientSecret: required('AUTH_CLIENT_SECRET'),
  publicPort: wholeNumber('APP_PUBLIC_PORT', 4173),
  publicUrl: (process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173').replace(/\/$/, ''),
  signInWindowSeconds: wholeNumber('SIGN_IN_WINDOW_SECONDS', 900),
  signInLockoutSeconds: wholeNumber('SIGN_IN_LOCKOUT_SECONDS', 900),
  sessionIdleSeconds: wholeNumber('SESSION_IDLE_SECONDS', 1800),
  sessionMaxSeconds: wholeNumber('SESSION_MAX_SECONDS', 43200),
  shareLinkTtlSeconds: wholeNumber('SHARE_LINK_TTL_SECONDS', 604800),
  shareLinkMints: wholeNumber('SHARE_LINK_MINTS', 10),
  shareLinkMintWindowMinutes: wholeNumber('SHARE_LINK_MINT_WINDOW_MINUTES', 15),
  employerSeededOn: process.env.EMPLOYER_SEEDED_ON || '',
};

export const SESSION_COOKIE = 'rostara_session';
