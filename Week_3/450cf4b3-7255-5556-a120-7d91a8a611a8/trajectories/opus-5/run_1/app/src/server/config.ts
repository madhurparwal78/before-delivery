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

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export const config = {
  port: number('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  kitchenTimeZone: optional('KITCHEN_TIME_ZONE', 'America/Chicago'),
  holdSeconds: number('HOLD_SECONDS', 90),
  expirySweepSeconds: number('EXPIRY_SWEEP_SECONDS', 3600),
  signinWindowSeconds: number('SIGNIN_WINDOW_SECONDS', 900),
  reauthSeconds: number('REAUTH_SECONDS', 300),
  killbill: {
    url: optional('KILLBILL_URL', 'http://killbill:8080').replace(/\/+$/, ''),
    username: optional('KILLBILL_USERNAME', ''),
    password: optional('KILLBILL_PASSWORD', ''),
    apiKey: optional('KILLBILL_API_KEY', ''),
    apiSecret: optional('KILLBILL_API_SECRET', ''),
  },
  storage: {
    endpoint: optional('S3_ENDPOINT', 'http://minio:9000').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: optional('S3_BUCKET', ''),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
  },
  mail: {
    host: optional('SMTP_HOST', 'mailpit'),
    port: number('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Stationhouse <frontdesk@stationhouse.test>'),
  },
} as const;
