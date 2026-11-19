export interface Config {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3PathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  wiremockUrl: string;
  gotenbergUrl: string;
  ntfyUrl: string;
  ntfyUsername: string;
  ntfyPassword: string;
  appPublicPort: number;
  appPublicUrl: string;
  publicDeskEmail: string;
  enquiryRateWindowSeconds: number;
  bidWindowSeconds: number;
  quoteValidSeconds: number | null;
  fileRateWindowSeconds: number;
  closureWaitSeconds: number;
  holidayCacheSeconds: number;
  dailyRunAt: string;
  sessionSeconds: number;
}

function num(v: string | undefined, d: number): number {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(): Config {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3Endpoint: process.env.S3_ENDPOINT ?? "",
    s3Region: process.env.S3_REGION ?? "us-east-1",
    s3Bucket: process.env.S3_BUCKET ?? "",
    s3PathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    smtpHost: process.env.SMTP_HOST ?? "localhost",
    smtpPort: num(process.env.SMTP_PORT, 1025),
    mailFrom: process.env.MAIL_FROM ?? "desk@wayticket.example",
    wiremockUrl: process.env.WIREMOCK_URL ?? "",
    gotenbergUrl: process.env.GOTENBERG_URL ?? "",
    ntfyUrl: process.env.NTFY_URL ?? "",
    ntfyUsername: process.env.NTFY_USERNAME ?? "",
    ntfyPassword: process.env.NTFY_PASSWORD ?? "",
    appPublicPort: num(process.env.APP_PUBLIC_PORT, 4173),
    appPublicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:4173`,
    publicDeskEmail: process.env.PUBLIC_DESK_EMAIL ?? "maria@merrowfield.example",
    enquiryRateWindowSeconds: num(process.env.ENQUIRY_RATE_WINDOW_SECONDS, 3600),
    bidWindowSeconds: num(process.env.BID_WINDOW_SECONDS, 172800),
    quoteValidSeconds: process.env.QUOTE_VALID_SECONDS ? num(process.env.QUOTE_VALID_SECONDS, 0) : null,
    fileRateWindowSeconds: num(process.env.FILE_RATE_WINDOW_SECONDS, 3600),
    closureWaitSeconds: num(process.env.CLOSURE_WAIT_SECONDS, 604800),
    holidayCacheSeconds: num(process.env.HOLIDAY_CACHE_SECONDS, 86400),
    dailyRunAt: process.env.DAILY_RUN_AT ?? "09:00",
    sessionSeconds: num(process.env.SESSION_SECONDS, 43200),
  };
}
