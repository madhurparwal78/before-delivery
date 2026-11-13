// The only reader of process.env. Every credential and address comes from here.

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

const port = whole("APP_PUBLIC_PORT", 4173);
const loopback = "127.0.0.1";

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://${loopback}:${port}`),
  gradingToken: process.env.GRADING_TOKEN ?? "",
  databaseUrl: text("DATABASE_URL"),
  meilisearchUrl: text("MEILISEARCH_URL"),
  meilisearchKey: text("MEILISEARCH_API_KEY"),
  s3Endpoint: text("S3_ENDPOINT"),
  s3Region: text("S3_REGION", "us-east-1"),
  s3Bucket: text("S3_BUCKET"),
  s3ForcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
  s3AccessKeyId: text("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  smtpHost: text("SMTP_HOST"),
  smtpPort: whole("SMTP_PORT", 1025),
  mailFrom: text("MAIL_FROM", "Roam House <orders@roamhouse.example>"),

  reservationTtlSeconds: whole("RESERVATION_TTL_SECONDS", 600),
  returnWindowDays: whole("RETURN_WINDOW_DAYS", 30),
  trialWindowDays: whole("TRIAL_WINDOW_DAYS", 30),
  warrantyYearsLuggage: whole("WARRANTY_YEARS_LUGGAGE", 3),
  warrantyYearsBags: whole("WARRANTY_YEARS_BAGS", 2),
  warrantyYearsAccessories: whole("WARRANTY_YEARS_ACCESSORIES", 1),
  lowStockThreshold: whole("LOW_STOCK_THRESHOLD", 3),
  taxRatePercent: whole("TAX_RATE_PERCENT", 18),
  freeShippingMinimum: whole("FREE_SHIPPING_MINIMUM", 5000),
  uploadMaxBytes: whole("UPLOAD_MAX_BYTES", 5_000_000),
  compareMax: whole("COMPARE_MAX", 3),
  pageSize: whole("PAGE_SIZE", 12),
  cartUndoSeconds: whole("CART_UNDO_SECONDS", 6),
  toastSeconds: whole("TOAST_SECONDS", 5),
};

export const publicOrigin = new URL(config.publicUrl).origin;
