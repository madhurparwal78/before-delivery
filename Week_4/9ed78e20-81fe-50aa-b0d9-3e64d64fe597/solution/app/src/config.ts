const env = process.env;
const seconds = (name: string, fallback: number): number =>
  Number(env[name] || fallback);
const port = Number(env.APP_PUBLIC_PORT || 4173);
export const config = {
  databaseUrl: env.DATABASE_URL,
  port,
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(
    /\/$/,
    "",
  ),
  s3Endpoint: env.S3_ENDPOINT || "",
  s3Region: env.S3_REGION || "",
  s3Bucket: env.S3_BUCKET || "",
  s3PathStyle: env.S3_FORCE_PATH_STYLE === "true",
  s3AccessKey: env.S3_ACCESS_KEY_ID || "",
  s3SecretKey: env.S3_SECRET_ACCESS_KEY || "",
  smtpHost: env.SMTP_HOST || "",
  smtpPort: Number(env.SMTP_PORT),
  mailFrom: env.MAIL_FROM || "Aldermoor Open Record <record@aldermoor.example>",
  outboxRetry: seconds("OUTBOX_RETRY_SECONDS", 10),
  outboxRetryMax: seconds("OUTBOX_RETRY_MAX_SECONDS", 60),
  jobMaxAttempts: seconds("JOB_MAX_ATTEMPTS", 5),
  retention: seconds("APPLICATION_RETENTION_SECONDS", 15552000),
  resendWindow: seconds("RESEND_WINDOW_SECONDS", 3600),
  sessionTtl: seconds("SESSION_TTL_SECONDS", 43200),
  signinLockout: seconds("SIGNIN_LOCKOUT_SECONDS", 30),
  idempotencyTtl: seconds("IDEMPOTENCY_TTL_SECONDS", 86400),
  rateLimits: {
    public: seconds("RATE_LIMIT_PUBLIC_PER_MINUTE", 600),
    candidate: seconds("RATE_LIMIT_CANDIDATE_PER_MINUTE", 60),
    signin: seconds("RATE_LIMIT_SIGNIN_PER_MINUTE", 20),
    console: seconds("RATE_LIMIT_CONSOLE_WRITES_PER_MINUTE", 120),
  },
  trustForwardedFor: env.TRUST_FORWARDED_FOR === "true",
};
