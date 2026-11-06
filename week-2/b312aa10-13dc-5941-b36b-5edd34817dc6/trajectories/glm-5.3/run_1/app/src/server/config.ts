export interface Config {
  port: number;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  holdTtlSeconds: number;
  noShowGraceSeconds: number;
  sweepSeconds: number;
  signinWindowSeconds: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function loadConfig(): Config {
  return {
    port: int(process.env.APP_PUBLIC_PORT, 4173),
    databaseUrl: requireEnv('DATABASE_URL'),
    killbillUrl: requireEnv('KILLBILL_URL'),
    killbillUsername: requireEnv('KILLBILL_USERNAME'),
    killbillPassword: requireEnv('KILLBILL_PASSWORD'),
    killbillApiKey: requireEnv('KILLBILL_API_KEY'),
    killbillApiSecret: requireEnv('KILLBILL_API_SECRET'),
    smtpHost: requireEnv('SMTP_HOST'),
    smtpPort: int(process.env.SMTP_PORT, 1025),
    mailFrom: requireEnv('MAIL_FROM'),
    s3Endpoint: requireEnv('S3_ENDPOINT'),
    s3Region: process.env.S3_REGION || 'us-east-1',
    s3Bucket: requireEnv('S3_BUCKET'),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    s3AccessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    holdTtlSeconds: int(process.env.LINEBOARD_HOLD_TTL_SECONDS, 600),
    noShowGraceSeconds: int(process.env.LINEBOARD_NO_SHOW_GRACE_SECONDS, 1800),
    sweepSeconds: int(process.env.LINEBOARD_SWEEP_SECONDS, 300),
    signinWindowSeconds: int(process.env.LINEBOARD_SIGNIN_WINDOW_SECONDS, 900),
  };
}
