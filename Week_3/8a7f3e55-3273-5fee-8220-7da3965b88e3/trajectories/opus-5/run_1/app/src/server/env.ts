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

function wholeNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be a whole number`);
  }
  return parsed;
}

export interface Env {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailpitUrl: string;
  mailFrom: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  appPublicPort: number;
  openCallLeadMinutes: number;
  prepAccessGraceMinutes: number;
  prepLinkTtlSeconds: number;
}

export const env: Env = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: wholeNumber('SMTP_PORT', 1025),
  mailpitUrl: required('MAILPIT_URL'),
  mailFrom: required('MAIL_FROM'),
  killbillUrl: required('KILLBILL_URL'),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: optional('S3_REGION', 'us-east-1'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  appPublicPort: wholeNumber('APP_PUBLIC_PORT', 4173),
  openCallLeadMinutes: wholeNumber('OPEN_CALL_LEAD_MINUTES', 1440),
  prepAccessGraceMinutes: wholeNumber('PREP_ACCESS_GRACE_MINUTES', 4320),
  prepLinkTtlSeconds: wholeNumber('PREP_LINK_TTL_SECONDS', 300),
};
