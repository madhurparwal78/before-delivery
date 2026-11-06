function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: optionalNumber('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  shareLinkSeconds: optionalNumber('SHARE_LINK_SECONDS', 604800),
  accountStorageBytes: optionalNumber('ACCOUNT_STORAGE_BYTES', 50_000_000),
};

export const FILE_BYTE_LIMIT = 5_000_000;
export const JSON_BYTE_LIMIT = 5_000_000;
export const SESSION_COOKIE = 'oddment_session';
