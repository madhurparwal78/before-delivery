function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}

const port = integer('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Conecount Paddock <paddock@pylonworks.test>'),
  },
  protestWindowSeconds: integer('PROTEST_WINDOW_SECONDS', 1800),
} as const;
