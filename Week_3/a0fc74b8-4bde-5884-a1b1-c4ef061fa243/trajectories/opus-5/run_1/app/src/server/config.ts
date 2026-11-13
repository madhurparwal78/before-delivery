const str = (name: string, fallback: string): string => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
};

const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

export interface Config {
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
  appPublicUrl: string;
  port: number;
  gradingKey: string | null;
  linkTtlSeconds: number;
  reminderCooldownSeconds: number;
  mailRetrySeconds: number;
  sealRetrySeconds: number;
}

const gradingKeyRaw = process.env['GRADING_KEY'];

export const config: Config = {
  databaseUrl: str('DATABASE_URL', 'postgresql://postgres@localhost:5432/postgres'),
  s3: {
    endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', 'undersign'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: { host: str('SMTP_HOST', 'localhost'), port: int('SMTP_PORT', 1025) },
  mailFrom: str('MAIL_FROM', 'Undersign <sign@wickmoor.example>'),
  appPublicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  port: int('APP_PUBLIC_PORT', 4173),
  gradingKey: gradingKeyRaw === undefined || gradingKeyRaw === '' ? null : gradingKeyRaw,
  linkTtlSeconds: int('LINK_TTL_SECONDS', 1209600),
  reminderCooldownSeconds: int('REMINDER_COOLDOWN_SECONDS', 86400),
  mailRetrySeconds: int('MAIL_RETRY_SECONDS', 30),
  sealRetrySeconds: int('SEAL_RETRY_SECONDS', 30),
};

export const MAX_JSON_BYTES = 1000000;
export const MAX_UPLOAD_BYTES = 25000000;
export const MAX_PAGES = 60;
export const MAX_RECIPIENTS = 10;
