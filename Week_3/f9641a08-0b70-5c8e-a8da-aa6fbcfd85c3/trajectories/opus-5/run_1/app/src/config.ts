function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  port: num('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  gradingToken: process.env.GRADING_TOKEN ?? '',
  databaseUrl: str('DATABASE_URL', ''),
  meilisearchUrl: str('MEILISEARCH_URL', ''),
  meilisearchApiKey: str('MEILISEARCH_API_KEY', ''),
  s3Endpoint: str('S3_ENDPOINT', ''),
  s3Region: str('S3_REGION', 'us-east-1'),
  s3Bucket: str('S3_BUCKET', ''),
  s3ForcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
  s3AccessKeyId: str('S3_ACCESS_KEY_ID', ''),
  s3SecretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  smtpHost: str('SMTP_HOST', 'localhost'),
  smtpPort: num('SMTP_PORT', 1025),
  mailFrom: str('MAIL_FROM', 'Roam House <orders@roamhouse.example>'),
  reservationTtlSeconds: num('RESERVATION_TTL_SECONDS', 600),
  returnWindowDays: num('RETURN_WINDOW_DAYS', 30),
  trialWindowDays: num('TRIAL_WINDOW_DAYS', 30),
  warrantyYearsLuggage: num('WARRANTY_YEARS_LUGGAGE', 3),
  warrantyYearsBags: num('WARRANTY_YEARS_BAGS', 2),
  warrantyYearsAccessories: num('WARRANTY_YEARS_ACCESSORIES', 1),
  lowStockThreshold: num('LOW_STOCK_THRESHOLD', 3),
  taxRatePercent: num('TAX_RATE_PERCENT', 18),
  freeShippingMinimum: num('FREE_SHIPPING_MINIMUM', 5000),
  uploadMaxBytes: num('UPLOAD_MAX_BYTES', 5000000),
  compareMax: num('COMPARE_MAX', 3),
  pageSize: num('PAGE_SIZE', 12),
  cartUndoSeconds: num('CART_UNDO_SECONDS', 6),
  toastSeconds: num('TOAST_SECONDS', 5),
  jsonMaxBytes: 1000000
};

export type PublicConfig = {
  reservation_ttl_seconds: number;
  return_window_days: number;
  trial_window_days: number;
  compare_max: number;
  page_size: number;
  cart_undo_seconds: number;
  toast_seconds: number;
  low_stock_threshold: number;
  free_shipping_minimum: number;
  tax_rate_percent: number;
  upload_max_bytes: number;
  warranty_years_luggage: number;
  warranty_years_bags: number;
  warranty_years_accessories: number;
};

export function publicConfig(): PublicConfig {
  return {
    reservation_ttl_seconds: config.reservationTtlSeconds,
    return_window_days: config.returnWindowDays,
    trial_window_days: config.trialWindowDays,
    compare_max: config.compareMax,
    page_size: config.pageSize,
    cart_undo_seconds: config.cartUndoSeconds,
    toast_seconds: config.toastSeconds,
    low_stock_threshold: config.lowStockThreshold,
    free_shipping_minimum: config.freeShippingMinimum,
    tax_rate_percent: config.taxRatePercent,
    upload_max_bytes: config.uploadMaxBytes,
    warranty_years_luggage: config.warrantyYearsLuggage,
    warranty_years_bags: config.warrantyYearsBags,
    warranty_years_accessories: config.warrantyYearsAccessories
  };
}
