function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function whole(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

export const config = {
  host: "0.0.0.0",
  port: whole("APP_PUBLIC_PORT", 4173, 1, 65535),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  search: { url: required("MEILISEARCH_URL").replace(/\/+$/, ""), apiKey: required("MEILISEARCH_API_KEY") },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
    inboxUrl: required("MAILPIT_URL").replace(/\/+$/, ""),
  },
  gradingToken: optional("GRADING_TOKEN"),
  founder: { email: optional("FOUNDER_EMAIL"), password: optional("FOUNDER_PASSWORD") },
  limits: {
    editWindowMinutes: whole("EDIT_WINDOW_MINUTES", 15, 1),
    emailCodeTtlSeconds: whole("EMAIL_CODE_TTL_SECONDS", 600, 1),
    emailLinkTtlSeconds: whole("EMAIL_LINK_TTL_SECONDS", 3600, 1),
    alertBatchSeconds: whole("ALERT_BATCH_SECONDS", 300, 1),
    minPayReports: whole("MIN_PAY_REPORTS", 5, 2, 50),
    reviewsPerCompanyPerYear: whole("REVIEWS_PER_COMPANY_PER_YEAR", 1, 1),
    resumeMaxBytes: whole("RESUME_MAX_BYTES", 5242880, 1),
    uploadRatePerMinute: whole("UPLOAD_RATE_PER_MINUTE", 5, 1),
    claimLapseSeconds: whole("CLAIM_LAPSE_SECONDS", 600, 1),
    applyKeyTtlSeconds: whole("APPLY_KEY_TTL_SECONDS", 86400, 1),
    liveReplayLimit: whole("LIVE_REPLAY_LIMIT", 500, 1),
    toastSeconds: whole("TOAST_SECONDS", 5, 1),
    searchPageSize: whole("SEARCH_PAGE_SIZE", 20, 1, 100),
    outboxRetrySeconds: whole("OUTBOX_RETRY_SECONDS", 30, 1),
  },
};
