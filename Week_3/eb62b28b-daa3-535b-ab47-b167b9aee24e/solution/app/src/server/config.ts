// The one place that reads the environment. Nothing here reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function numberOr(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killBill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  publicPort: numberOr("APP_PUBLIC_PORT", 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
  sessionSeconds: numberOr("SESSION_SECONDS", 43200),
  messageRateWindowSeconds: numberOr("MESSAGE_RATE_WINDOW_SECONDS", 3600),
  fileRateWindowSeconds: numberOr("FILE_RATE_WINDOW_SECONDS", 3600),
  closureWaitSeconds: numberOr("CLOSURE_WAIT_SECONDS", 2592000),
  drawPageSeconds: process.env["DRAW_PAGE_SECONDS"] ? Number(process.env["DRAW_PAGE_SECONDS"]) : null,
};
