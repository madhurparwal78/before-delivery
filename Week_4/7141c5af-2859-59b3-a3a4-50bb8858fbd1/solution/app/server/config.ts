function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

export const config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
  publicUrl: process.env.APP_PUBLIC_URL?.replace(/\/+$/, "") || null,
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env.MAIL_FROM || "Semenza Desk <desk@bottega-semenza.example>",
  wiremockUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
  gotenbergUrl: required("GOTENBERG_URL").replace(/\/+$/, ""),
  meilisearch: {
    url: required("MEILISEARCH_URL").replace(/\/+$/, ""),
    apiKey: process.env.MEILISEARCH_API_KEY ?? "",
    index: `${process.env.SEARCH_INDEX_PREFIX || "main"}_entries`,
  },
  enquiryRateWindowSeconds: seconds("ENQUIRY_RATE_WINDOW_SECONDS", 3600),
  fileRateWindowSeconds: seconds("FILE_RATE_WINDOW_SECONDS", 3600),
  stockCacheSeconds: seconds("STOCK_CACHE_SECONDS", 300),
  closureWaitSeconds: seconds("CLOSURE_WAIT_SECONDS", 2592000),
  holdDays: seconds("HOLD_DAYS", 7),
  clientPageSeconds: seconds("CLIENT_PAGE_SECONDS", 1209600),
  reminderAfterSeconds: seconds("REMINDER_AFTER_SECONDS", 604800),
  sessionSeconds: seconds("SESSION_SECONDS", 604800),
};
