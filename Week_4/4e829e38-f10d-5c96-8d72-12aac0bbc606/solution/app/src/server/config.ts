const env = process.env;

function number(name: string, fallback: number): number {
  const raw = env[name];
  return raw === undefined || raw.trim() === "" ? fallback : Number(raw);
}

export const config = {
  port: number("APP_PUBLIC_PORT", 4173),
  databaseUrl: env.DATABASE_URL ?? "",
  s3: {
    endpoint: (env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: env.S3_REGION ?? "us-east-1",
    bucket: env.S3_BUCKET ?? "",
    pathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  },
  smtp: { host: env.SMTP_HOST ?? "localhost", port: number("SMTP_PORT", 1025) },
  mailFrom: env.MAIL_FROM ?? "Everyweek <hello@everyweek.example>",
  grading: env.EVERYWEEK_GRADING === "1",
  limits: {
    ruleMaxDepth: number("EVERYWEEK_RULE_MAX_DEPTH", 3),
    ruleRunsPerMinute: number("EVERYWEEK_RULE_RUNS_PER_MINUTE", 60),
    formulaMaxChars: number("EVERYWEEK_FORMULA_MAX_CHARS", 200),
    formulaMaxSteps: number("EVERYWEEK_FORMULA_MAX_STEPS", 500),
    digestWindowMin: number("EVERYWEEK_DIGEST_WINDOW_MIN", 60),
    holdTimeoutMs: number("EVERYWEEK_HOLD_TIMEOUT_MS", 30000),
    uploadMaxBytes: number("EVERYWEEK_UPLOAD_MAX_BYTES", 1048576),
    pageSize: number("EVERYWEEK_PAGE_SIZE", 50),
    moveMs: number("EVERYWEEK_MOVE_MS", 320),
    progressMs: number("EVERYWEEK_PROGRESS_MS", 400),
    toastMs: number("EVERYWEEK_TOAST_MS", 4000),
  },
  jsonBodyBytes: 262144,
  seedBodyBytes: 5_000_000,
  dueTickMs: 15000,
} as const;
