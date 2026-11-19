function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer of seconds`);
  }
  return parsed;
}

export type Config = {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  mailFrom: string;
  holdSeconds: number;
  holdSweepSeconds: number;
  requestKeyTtlSeconds: number;
  sessionSeconds: number;
  signInWindowSeconds: number;
  port: number;
  publicUrl: string;
};

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE').toLowerCase() === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: Number.parseInt(required('SMTP_PORT'), 10) },
  mailFrom: process.env['MAIL_FROM'] || 'Tramela Estate <encomendas@tramela.example>',
  holdSeconds: seconds('HOLD_SECONDS', 600),
  holdSweepSeconds: seconds('HOLD_SWEEP_SECONDS', 15),
  requestKeyTtlSeconds: seconds('REQUEST_KEY_TTL_SECONDS', 86400),
  sessionSeconds: seconds('SESSION_SECONDS', 43200),
  signInWindowSeconds: seconds('SIGN_IN_WINDOW_SECONDS', 900),
  port: seconds('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env['APP_PUBLIC_URL'] || '',
};
