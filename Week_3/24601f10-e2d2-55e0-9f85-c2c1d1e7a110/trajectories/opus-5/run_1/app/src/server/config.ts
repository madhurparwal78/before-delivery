const intFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be a whole number`);
  }
  return value;
};

const required = (name: string): string => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') throw new Error(`${name} is required`);
  return raw;
};

export const config = {
  port: intFromEnv('APP_PUBLIC_PORT', 4173),
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${intFromEnv('APP_PUBLIC_PORT', 4173)}`).replace(
    /\/+$/,
    '',
  ),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  grading: process.env.CUPFOLD_GRADING === '1',
  confirmWindowMs: intFromEnv('CUPFOLD_CONFIRM_WINDOW_MS', 600000),
  matchLimitMs: intFromEnv('CUPFOLD_MATCH_LIMIT_MS', 1800000),
  swissRoundMs: intFromEnv('CUPFOLD_SWISS_ROUND_MS', 3000000),
  checkinDefaultMs: intFromEnv('CUPFOLD_CHECKIN_DEFAULT_MS', 3600000),
  reportRate: intFromEnv('CUPFOLD_REPORT_RATE', 20),
  loginRate: intFromEnv('CUPFOLD_LOGIN_RATE', 10),
  rosterMaxBytes: intFromEnv('CUPFOLD_ROSTER_MAX_BYTES', 65536),
  logoMaxBytes: intFromEnv('CUPFOLD_LOGO_MAX_BYTES', 524288),
  toastMs: intFromEnv('CUPFOLD_TOAST_MS', 4000),
} as const;

export const JSON_BODY_MAX_BYTES = 65536;
export const RATE_WINDOW_MS = 60000;
