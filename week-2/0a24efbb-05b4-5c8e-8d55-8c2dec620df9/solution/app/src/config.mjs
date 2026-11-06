// Every location, credential and limit the desk reads, taken from the environment once at start.

function whole(name, fallback) {
  const raw = process.env[name];
  return raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
}

export const config = Object.freeze({
  databaseUrl: process.env.DATABASE_URL ?? "",
  issuerUrl: (process.env.AUTH_ISSUER_URL
    || `${(process.env.KEYCLOAK_URL ?? "").replace(/\/+$/, "")}/realms/${process.env.KEYCLOAK_REALM ?? ""}`).replace(/\/+$/, ""),
  clientId: process.env.AUTH_CLIENT_ID ?? "",
  clientSecret: process.env.AUTH_CLIENT_SECRET ?? "",
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: (process.env.APP_PUBLIC_URL ?? "").replace(/\/+$/, ""),
  signInWindowSeconds: whole("SIGN_IN_WINDOW_SECONDS", 900),
  signInLockoutSeconds: whole("SIGN_IN_LOCKOUT_SECONDS", 900),
  sessionIdleSeconds: whole("SESSION_IDLE_SECONDS", 1800),
  sessionMaxSeconds: whole("SESSION_MAX_SECONDS", 43200),
  shareLinkTtlSeconds: whole("SHARE_LINK_TTL_SECONDS", 604800),
  shareLinkMints: whole("SHARE_LINK_MINTS", 10),
  shareLinkMintWindowMinutes: whole("SHARE_LINK_MINT_WINDOW_MINUTES", 15),
  employerSeededOn: process.env.EMPLOYER_SEEDED_ON ?? "",
});
