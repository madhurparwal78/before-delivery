// The only place the environment is read.

function text(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: (process.env['APP_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  grading: process.env['CUPFOLD_GRADING'] === '1',
  confirmWindowMs: whole('CUPFOLD_CONFIRM_WINDOW_MS', 600000),
  matchLimitMs: whole('CUPFOLD_MATCH_LIMIT_MS', 1800000),
  swissRoundMs: whole('CUPFOLD_SWISS_ROUND_MS', 3000000),
  checkinDefaultMs: whole('CUPFOLD_CHECKIN_DEFAULT_MS', 3600000),
  reportRate: whole('CUPFOLD_REPORT_RATE', 20),
  loginRate: whole('CUPFOLD_LOGIN_RATE', 10),
  rosterMaxBytes: whole('CUPFOLD_ROSTER_MAX_BYTES', 65536),
  logoMaxBytes: whole('CUPFOLD_LOGO_MAX_BYTES', 524288),
  toastMs: whole('CUPFOLD_TOAST_MS', 4000),
  jsonLimitBytes: 65536,
} as const;
