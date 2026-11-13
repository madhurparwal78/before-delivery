export const CONFIG = {
  port: intFromEnv('APP_PUBLIC_PORT', 4173),
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:4173`).replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL ?? '',
  gradingToken: process.env.GRADING_TOKEN ?? null,
  reservationTtlSeconds: intFromEnv('RESERVATION_TTL_SECONDS', 600),
  returnWindowDays: intFromEnv('RETURN_WINDOW_DAYS', 30),
  trialWindowDays: intFromEnv('TRIAL_WINDOW_DAYS', 30),
  warrantyYearsLuggage: intFromEnv('WARRANTY_YEARS_LUGGAGE', 3),
  warrantyYearsBags: intFromEnv('WARRANTY_YEARS_BAGS', 2),
  warrantyYearsAccessories: intFromEnv('WARRANTY_YEARS_ACCESSORIES', 1),
  lowStockThreshold: intFromEnv('LOW_STOCK_THRESHOLD', 3),
  taxRatePercent: intFromEnv('TAX_RATE_PERCENT', 18),
  freeShippingMinimum: intFromEnv('FREE_SHIPPING_MINIMUM', 5000),
  uploadMaxBytes: intFromEnv('UPLOAD_MAX_BYTES', 5_000_000),
  compareMax: intFromEnv('COMPARE_MAX', 3),
  pageSize: intFromEnv('PAGE_SIZE', 12),
  cartUndoSeconds: intFromEnv('CART_UNDO_SECONDS', 6),
  toastSeconds: intFromEnv('TOAST_SECONDS', 5),
  meilisearchUrl: (process.env.MEILISEARCH_URL ?? '').replace(/\/$/, ''),
  meilisearchApiKey: process.env.MEILISEARCH_API_KEY ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: intFromEnv('SMTP_PORT', 1025),
  mailFrom: process.env.MAIL_FROM ?? 'Roam House <orders@roamhouse.example>',
  s3Endpoint: (process.env.S3_ENDPOINT ?? '').replace(/\/$/, ''),
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  jsonBodyLimitBytes: 1_000_000,
};

export type AppConfig = typeof CONFIG;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
