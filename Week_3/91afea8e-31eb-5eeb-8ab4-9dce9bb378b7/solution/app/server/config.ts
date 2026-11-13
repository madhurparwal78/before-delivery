function text(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : Number(value);
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: text("KILLBILL_URL").replace(/\/$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET"),
  },
  meilisearch: {
    url: text("MEILISEARCH_URL").replace(/\/$/, ""),
    apiKey: text("MEILISEARCH_API_KEY"),
    index: process.env.SEARCH_INDEX || "listings",
  },
  wiremockUrl: text("WIREMOCK_URL").replace(/\/$/, ""),
  seconds: {
    otpTtl: seconds("OTP_TTL_SECONDS", 300),
    codeWindow: seconds("CODE_WINDOW_SECONDS", 900),
    codeResend: seconds("CODE_RESEND_SECONDS", 30),
    accessTtl: seconds("ACCESS_TTL_SECONDS", 900),
    sessionTtl: seconds("SESSION_TTL_SECONDS", 2592000),
    upiExpiry: seconds("UPI_EXPIRY_SECONDS", 600),
    shareTtl: seconds("SHARE_TTL_SECONDS", 2592000),
    rateWindow: seconds("RATE_WINDOW_SECONDS", 60),
    idempotencyTtl: seconds("IDEMPOTENCY_TTL_SECONDS", 86400),
  },
} as const;
