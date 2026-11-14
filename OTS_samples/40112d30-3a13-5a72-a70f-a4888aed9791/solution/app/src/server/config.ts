// Every credential, URL, timer and limit is read here once at start (brief: Configuration and secrets).

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function whole(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

function valkeyTarget(raw: string): { host: string; port: number; username?: string; password?: string; db: number } {
  const url = new URL(raw);
  const db = Number(url.pathname.replace('/', '') || '0');
  return {
    host: url.hostname,
    port: Number(url.port || '6379'),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
  };
}

const port = process.env['APP_PUBLIC_PORT'] ? whole('APP_PUBLIC_PORT') : 4173;

export const config = {
  port,
  baseUrl: (process.env['APP_BASE_URL'] || process.env['APP_PUBLIC_URL'] || `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  valkey: valkeyTarget(required('VALKEY_URL')),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: required('SMTP_HOST'), port: whole('SMTP_PORT'), from: required('MAIL_FROM') },
  gradingKey: process.env['GRADING_KEY'] || null,
  timeZone: required('APP_TZ'),
  resumeTtlHours: whole('RESUME_TTL_HOURS'),
  inviteTtlHours: whole('INVITE_TTL_HOURS'),
  shuffleSeed: required('SHUFFLE_SEED'),
  uploadMaxBytes: whole('UPLOAD_MAX_BYTES'),
  resumeEmailPerHour: whole('RESUME_EMAIL_PER_HOUR'),
  submitPerMinute: whole('SUBMIT_PER_MINUTE'),
  formulaMaxChars: whole('FORMULA_MAX_CHARS'),
  formulaMaxDepth: whole('FORMULA_MAX_DEPTH'),
  exportLinkTtlMinutes: whole('EXPORT_LINK_TTL_MINUTES'),
} as const;
