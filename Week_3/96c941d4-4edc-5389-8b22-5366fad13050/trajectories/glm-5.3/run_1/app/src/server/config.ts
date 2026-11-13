// Explicit service configuration; no fallback expressions on service reads.
const missing: string[] = [];
function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value === '') {
    missing.push(name);
    return '';
  }
  return value;
}

export const config = {
  publicUrl: process.env.APP_PUBLIC_URL ?? '',
  publicPort: (() => {
    const raw = process.env.APP_PUBLIC_PORT;
    if (typeof raw === 'string' && raw !== '') return Number(raw);
    return 4173;
  })(),
  databaseUrl: requireEnv('DATABASE_URL'),
  s3: {
    endpoint: requireEnv('S3_ENDPOINT'),
    region: requireEnv('S3_REGION'),
    bucket: requireEnv('S3_BUCKET'),
    forcePathStyle: requireEnv('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
  },
  meilisearch: {
    url: requireEnv('MEILISEARCH_URL'),
    apiKey: requireEnv('MEILISEARCH_API_KEY'),
  },
};

export const missingConfig = missing;

export function configComplete(): boolean {
  return missing.length === 0;
}

export function configDiagnostic(): string {
  return `Missing required configuration: ${missing.join(', ')}. Set these environment variables and restart.`;
}
