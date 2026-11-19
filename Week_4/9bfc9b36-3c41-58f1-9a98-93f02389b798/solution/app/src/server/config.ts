/** Every environment variable the server reads, read once. */

function text(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: text("DATABASE_URL"),
  keycloakUrl: text("KEYCLOAK_URL").replace(/\/+$/, ""),
  keycloakRealm: text("KEYCLOAK_REALM"),
  issuerUrl: text("AUTH_ISSUER_URL").replace(/\/+$/, ""),
  clientId: text("AUTH_CLIENT_ID"),
  clientSecret: text("AUTH_CLIENT_SECRET"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    pathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  claimHoldSeconds: whole("CLAIM_HOLD_SECONDS", 1200),
  ownerSubmissionLimit: whole("OWNER_SUBMISSION_LIMIT", 10),
  ownerSheetFetchLimit: whole("OWNER_SHEET_FETCH_LIMIT", 30),
  ownerRateWindowSeconds: whole("OWNER_RATE_WINDOW_SECONDS", 3600),
} as const;
