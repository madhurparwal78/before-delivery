export interface Config {
  port: number;
  databaseUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  issuerUrl: string;
  authClientId: string;
  authClientSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  claimHoldSeconds: number;
  ownerSubmissionLimit: number;
  ownerSheetFetchLimit: number;
  ownerRateWindowSeconds: number;
}

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : fallback;
}

export function readConfig(): Config {
  return {
    port: process.env['APP_PUBLIC_PORT'] ? num(process.env['APP_PUBLIC_PORT'], 4173) : 4173,
    databaseUrl: requireEnv('DATABASE_URL'),
    keycloakUrl: requireEnv('KEYCLOAK_URL'),
    keycloakRealm: requireEnv('KEYCLOAK_REALM'),
    issuerUrl: requireEnv('AUTH_ISSUER_URL'),
    authClientId: requireEnv('AUTH_CLIENT_ID'),
    authClientSecret: requireEnv('AUTH_CLIENT_SECRET'),
    s3Endpoint: requireEnv('S3_ENDPOINT'),
    s3Region: requireEnv('S3_REGION'),
    s3Bucket: requireEnv('S3_BUCKET'),
    s3ForcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    s3AccessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    claimHoldSeconds: num(process.env['CLAIM_HOLD_SECONDS'], 1200),
    ownerSubmissionLimit: num(process.env['OWNER_SUBMISSION_LIMIT'], 10),
    ownerSheetFetchLimit: num(process.env['OWNER_SHEET_FETCH_LIMIT'], 30),
    ownerRateWindowSeconds: num(process.env['OWNER_RATE_WINDOW_SECONDS'], 3600),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
