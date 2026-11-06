// The one place the server reads its environment. Nothing here is ever sent to the browser.

const env = process.env;

function seconds(name: string, fallback: number): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

function text(name: string): string {
  return env[name] ?? "";
}

const port = parseInt(env.APP_PUBLIC_PORT || "4173", 10);

export const config = {
  port,
  publicUrl: (env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: text("KILLBILL_URL").replace(/\/+$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: text("SMTP_HOST"),
    port: parseInt(text("SMTP_PORT"), 10),
    from: text("MAIL_FROM"),
  },
  timers: {
    answerWindow: seconds("ANSWER_WINDOW_SECONDS", 3600),
    reviewClaim: seconds("REVIEW_CLAIM_SECONDS", 900),
    dataRequestPage: seconds("DATA_REQUEST_PAGE_SECONDS", 86400),
    retention: seconds("RETENTION_SECONDS", 157680000),
    partnerRateWindow: seconds("PARTNER_RATE_WINDOW_SECONDS", 60),
    regulatorFileRateWindow: seconds("REGULATOR_FILE_RATE_WINDOW_SECONDS", 600),
    session: seconds("SESSION_SECONDS", 28800),
  },
};
