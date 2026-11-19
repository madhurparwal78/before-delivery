// Every setting and credential the app reads, read once at start.
const need = (name: string): string => process.env[name] ?? "";
const seconds = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  databaseUrl: need("DATABASE_URL"),
  s3: {
    endpoint: need("S3_ENDPOINT").replace(/\/$/, ""),
    region: need("S3_REGION"),
    bucket: need("S3_BUCKET"),
    forcePathStyle: need("S3_FORCE_PATH_STYLE") !== "false",
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
  },
  smtpHost: need("SMTP_HOST"),
  smtpPort: Number(need("SMTP_PORT")) || 1025,
  mailFrom: need("MAIL_FROM"),
  wiremockUrl: need("WIREMOCK_URL").replace(/\/$/, ""),
  gotenbergUrl: need("GOTENBERG_URL").replace(/\/$/, ""),
  ntfyUrl: need("NTFY_URL").replace(/\/$/, ""),
  ntfyUsername: need("NTFY_USERNAME"),
  ntfyPassword: need("NTFY_PASSWORD"),
  port: Number(process.env.APP_PUBLIC_PORT) || 4173,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://127.0.0.1:${Number(process.env.APP_PUBLIC_PORT) || 4173}`).replace(/\/$/, ""),
  publicDeskEmail: process.env.PUBLIC_DESK_EMAIL || "maria@merrowfield.example",
  enquiryRateWindow: seconds("ENQUIRY_RATE_WINDOW_SECONDS", 3600),
  bidWindow: seconds("BID_WINDOW_SECONDS", 172800),
  quoteValidSeconds: process.env.QUOTE_VALID_SECONDS ? seconds("QUOTE_VALID_SECONDS", 0) : null,
  fileRateWindow: seconds("FILE_RATE_WINDOW_SECONDS", 3600),
  closureWait: seconds("CLOSURE_WAIT_SECONDS", 604800),
  holidayCache: seconds("HOLIDAY_CACHE_SECONDS", 86400),
  dailyRunAt: process.env.DAILY_RUN_AT || "09:00",
  sessionSeconds: seconds("SESSION_SECONDS", 43200),
};
