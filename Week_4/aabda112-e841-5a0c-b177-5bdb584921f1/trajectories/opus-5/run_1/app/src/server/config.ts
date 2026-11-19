function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  databaseUrl: str('DATABASE_URL', 'postgresql://postgres@localhost:5432/postgres'),
  smtpHost: str('SMTP_HOST', 'localhost'),
  smtpPort: int('SMTP_PORT', 1025),
  mailpitUrl: str('MAILPIT_URL', 'http://localhost:8025'),
  mailFrom: str('MAIL_FROM', 'Roundbook <no-reply@roundbook.test>'),
  s3Endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
  s3Region: str('S3_REGION', 'us-east-1'),
  s3Bucket: str('S3_BUCKET', 'gf-dev'),
  s3ForcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
  s3AccessKeyId: str('S3_ACCESS_KEY_ID', ''),
  s3SecretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
  gradingToken: process.env.GRADING_TOKEN ?? '',
  port: int('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? '',
} as const;

export const settings = {
  slotMinutes: int('SLOT_MINUTES', 15),
  lateMinutes: int('LATE_MINUTES', 10),
  treatmentGraceMinutes: int('TREATMENT_GRACE_MINUTES', 15),
  admissionLingerHours: int('ADMISSION_LINGER_HOURS', 12),
  bookingLeadMinutes: int('BOOKING_LEAD_MINUTES', 30),
  bookingHorizonDays: int('BOOKING_HORIZON_DAYS', 28),
  reminderLeadDays: int('REMINDER_LEAD_DAYS', 28),
  reminderHour: int('REMINDER_HOUR', 9),
  undoSeconds: int('UNDO_SECONDS', 10),
  waitTickSeconds: int('WAIT_TICK_SECONDS', 60),
  uploadMaxMb: int('UPLOAD_MAX_MB', 10),
  bookingRatePerMinute: int('BOOKING_RATE_PER_MINUTE', 10),
  vatPercent: int('VAT_PERCENT', 20),
  idempotencyKeyHours: int('IDEMPOTENCY_KEY_HOURS', 24),
} as const;

export const CLINIC_OPEN_MINUTE = 8 * 60;
export const CLINIC_CLOSE_MINUTE = 18 * 60;
export const TIME_ZONE = 'Europe/London';
export const SEED_PASSWORD = 'roundbook-demo-1';

/** Settings the browser may read; no credential or service URL is ever sent. */
export const browserSettings = {
  slotMinutes: settings.slotMinutes,
  lateMinutes: settings.lateMinutes,
  uploadMaxMb: settings.uploadMaxMb,
  vatPercent: settings.vatPercent,
  waitTickSeconds: settings.waitTickSeconds,
  undoSeconds: settings.undoSeconds,
  openMinute: CLINIC_OPEN_MINUTE,
  closeMinute: CLINIC_CLOSE_MINUTE,
} as const;
