function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  port: num('APP_PUBLIC_PORT', 4173),
  databaseUrl: str('DATABASE_URL', ''),
  grading: process.env.EVERYWEEK_GRADING === '1',
  s3: {
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET', ''),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  },
  mail: {
    host: str('SMTP_HOST', ''),
    port: num('SMTP_PORT', 1025),
    from: str('MAIL_FROM', 'Everyweek <hello@everyweek.example>'),
  },
  ruleMaxDepth: num('EVERYWEEK_RULE_MAX_DEPTH', 3),
  ruleRunsPerMinute: num('EVERYWEEK_RULE_RUNS_PER_MINUTE', 60),
  formulaMaxChars: num('EVERYWEEK_FORMULA_MAX_CHARS', 200),
  formulaMaxSteps: num('EVERYWEEK_FORMULA_MAX_STEPS', 500),
  digestWindowMin: num('EVERYWEEK_DIGEST_WINDOW_MIN', 60),
  holdTimeoutMs: num('EVERYWEEK_HOLD_TIMEOUT_MS', 30000),
  uploadMaxBytes: num('EVERYWEEK_UPLOAD_MAX_BYTES', 1048576),
  pageSize: num('EVERYWEEK_PAGE_SIZE', 50),
  moveMs: num('EVERYWEEK_MOVE_MS', 320),
  progressMs: num('EVERYWEEK_PROGRESS_MS', 400),
  toastMs: num('EVERYWEEK_TOAST_MS', 4000),
} as const;

export const JSON_BODY_LIMIT = 262144;
export const SEED_BODY_LIMIT = 5000000;

/** `1 MB` when the cap is a whole number of mebibytes, otherwise `<n> bytes`. */
export function uploadCapLabel(): string {
  const mib = 1048576;
  return config.uploadMaxBytes % mib === 0
    ? `${config.uploadMaxBytes / mib} MB`
    : `${config.uploadMaxBytes} bytes`;
}
