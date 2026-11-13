/** Every service credential, URL and setting is read from the environment at start. */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  databaseUrl: string;
  s3: S3Config;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  roundSeconds: number;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function wholeSeconds(raw: string | undefined, fallback: number, least: number, most: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < least || value > most) {
    throw new Error(`ROUND_SECONDS must be a whole number of seconds from ${least} to ${most}`);
  }
  return value;
}

export function readConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    mailFrom: required('MAIL_FROM'),
    roundSeconds: wholeSeconds(process.env['ROUND_SECONDS'], 240, 5, 3600),
    port: Number(process.env['APP_PUBLIC_PORT'] ?? 4173),
  };
}
