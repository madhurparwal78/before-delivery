function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

/** The database name at the end of DATABASE_URL, used as the scope of shared services. */
function databaseName(databaseUrl: string): string {
  const path = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (path === '') throw new Error('DATABASE_URL has no database name');
  return decodeURIComponent(path);
}

const databaseUrl = required('DATABASE_URL');

export const env = {
  databaseUrl,
  databaseName: databaseName(databaseUrl),
  pocketbase: {
    url: required('POCKETBASE_URL').replace(/\/$/, ''),
    adminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    adminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    mailpitUrl: required('MAILPIT_URL').replace(/\/$/, ''),
    from: required('MAIL_FROM'),
  },
  app: {
    port: integer('APP_PUBLIC_PORT', 4173),
    publicUrl: required('APP_PUBLIC_URL').replace(/\/$/, ''),
  },
  timing: {
    holdSeconds: integer('HOLD_SECONDS', 900),
    dunningDaySeconds: integer('DUNNING_DAY_SECONDS', 86_400),
    changeCutoffHours: integer('CHANGE_CUTOFF_HOURS', 48),
  },
} as const;
