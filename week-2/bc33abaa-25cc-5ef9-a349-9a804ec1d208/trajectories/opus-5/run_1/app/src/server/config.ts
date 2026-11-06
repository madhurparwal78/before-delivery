function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  }
  return Math.floor(parsed);
}

const port = Number(optional('APP_PUBLIC_PORT', '4173'));

export const config = {
  port,
  publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  pocketbase: {
    url: required('POCKETBASE_URL').replace(/\/+$/, ''),
    adminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    adminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '1025')),
    from: optional('MAIL_FROM', 'Orrery Studio <studio@orrery-labs.test>'),
  },
  time: {
    trialLengthSeconds: seconds('TRIAL_LENGTH_SECONDS', 1_209_600),
    dunningDaySeconds: seconds('DUNNING_DAY_SECONDS', 86_400),
    tokenWarningLeadSeconds: seconds('TOKEN_WARNING_LEAD_SECONDS', 86_400),
  },
} as const;

export const SEED_TRIAL_SECONDS = 1_209_600;
