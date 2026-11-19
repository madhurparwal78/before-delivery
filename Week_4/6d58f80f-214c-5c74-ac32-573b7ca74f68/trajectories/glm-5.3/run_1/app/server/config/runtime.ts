import { randomBytes } from 'node:crypto';

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function requireEnv(name: string, fallback: string): string {
  return readEnv(name) ?? fallback;
}

const urlShape = /^(https?|postgres(ql)?):\/\/[^/]+/;
function requireUrl(name: string): string {
  const v = readEnv(name);
  if (!v || !urlShape.test(v)) {
    console.error(`Missing or invalid required environment variable ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  databaseUrl: requireUrl('DATABASE_URL'),
  s3: {
    endpoint: requireUrl('S3_ENDPOINT'),
    region: readEnv('S3_REGION') ?? 'us-east-1',
    bucket: requireEnv('S3_BUCKET', 'gf-dev'),
    forcePathStyle: readEnv('S3_FORCE_PATH_STYLE') !== 'false',
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY', ''),
  },
  pocketbase: {
    url: requireUrl('POCKETBASE_URL'),
    adminEmail: readEnv('POCKETBASE_ADMIN_EMAIL') ?? '',
    adminPassword: readEnv('POCKETBASE_ADMIN_PASSWORD') ?? '',
  },
  appPort: Number(readEnv('APP_PUBLIC_PORT') ?? '4173'),
  appUrl: readEnv('APP_PUBLIC_URL') ?? `http://127.0.0.1:${readEnv('APP_PUBLIC_PORT') ?? '4173'}`,
  storageQuotaBytes: Number(readEnv('STORAGE_QUOTA_BYTES') ?? '100000000000'),
  clockControl: readEnv('LINTEL_CLOCK_CONTROL') === 'on',
  linkSecret: randomBytes(32),
} as const;

export const uploadPauseTtlSeconds = Number(readEnv('UPLOAD_PAUSE_TTL_SECONDS') ?? '86400');
