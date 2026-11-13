/** App configuration, read from the environment at start. */
export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  pocketbaseUrl: string;
  pocketbaseAdminEmail: string;
  pocketbaseAdminPassword: string;
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
  dunningRetrySeconds: number;
  mediaLinkSeconds: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function readConfig(): Config {
  return {
    port: Number(optional('APP_PUBLIC_PORT', '4173')),
    publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${optional('APP_PUBLIC_PORT', '4173')}`),
    databaseUrl: required('DATABASE_URL'),
    pocketbaseUrl: required('POCKETBASE_URL'),
    pocketbaseAdminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    pocketbaseAdminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
    killbillUrl: required('KILLBILL_URL'),
    killbillUsername: required('KILLBILL_USERNAME'),
    killbillPassword: required('KILLBILL_PASSWORD'),
    killbillApiKey: required('KILLBILL_API_KEY'),
    killbillApiSecret: required('KILLBILL_API_SECRET'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    mailFrom: required('MAIL_FROM'),
    s3Endpoint: required('S3_ENDPOINT'),
    s3Region: optional('S3_REGION', 'us-east-1'),
    s3Bucket: required('S3_BUCKET'),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    dunningRetrySeconds: Number(optional('DUNNING_RETRY_SECONDS', '259200')),
    mediaLinkSeconds: Number(optional('MEDIA_LINK_SECONDS', '300')),
  };
}
