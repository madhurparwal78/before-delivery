function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly keycloakUrl: string;
  readonly keycloakRealm: string;
  readonly authIssuerUrl: string;
  readonly authClientId: string;
  readonly authClientSecret: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly claimHoldSeconds: number;
  readonly ownerSubmissionLimit: number;
  readonly ownerSheetFetchLimit: number;
  readonly ownerRateWindowSeconds: number;
}

export const config: Config = {
  port: optionalInt('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  keycloakUrl: required('KEYCLOAK_URL').replace(/\/+$/, ''),
  keycloakRealm: required('KEYCLOAK_REALM'),
  authIssuerUrl: required('AUTH_ISSUER_URL').replace(/\/+$/, ''),
  authClientId: required('AUTH_CLIENT_ID'),
  authClientSecret: required('AUTH_CLIENT_SECRET'),
  s3Endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true').toLowerCase() !== 'false',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  claimHoldSeconds: optionalInt('CLAIM_HOLD_SECONDS', 1200),
  ownerSubmissionLimit: optionalInt('OWNER_SUBMISSION_LIMIT', 10),
  ownerSheetFetchLimit: optionalInt('OWNER_SHEET_FETCH_LIMIT', 30),
  ownerRateWindowSeconds: optionalInt('OWNER_RATE_WINDOW_SECONDS', 3600),
};

export const SESSION_COOKIE = 'boltrope_session';
export const JSON_BODY_LIMIT = 65536;
export const PHOTO_BODY_LIMIT = 5000000;
