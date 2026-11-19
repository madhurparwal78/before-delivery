/** The one place the environment is read. Nothing here reaches the browser. */
function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback === undefined) throw new Error(`${name} is not set`);
  return fallback;
}

function whole(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) throw new Error(`${name} is not set`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ?? '',
  get baseUrl(): string {
    return this.publicUrl || `http://127.0.0.1:${this.port}`;
  },
  gradingToken: process.env.GRADING_TOKEN ?? '',
  databaseUrl: text('DATABASE_URL'),
  smtpHost: text('SMTP_HOST'),
  smtpPort: whole('SMTP_PORT'),
  mailFrom: text('MAIL_FROM', 'Roundbook <no-reply@roundbook.test>'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  slotMinutes: whole('SLOT_MINUTES', 15),
  lateMinutes: whole('LATE_MINUTES', 10),
  treatmentGraceMinutes: whole('TREATMENT_GRACE_MINUTES', 15),
  admissionLingerHours: whole('ADMISSION_LINGER_HOURS', 12),
  bookingLeadMinutes: whole('BOOKING_LEAD_MINUTES', 30),
  bookingHorizonDays: whole('BOOKING_HORIZON_DAYS', 28),
  reminderLeadDays: whole('REMINDER_LEAD_DAYS', 28),
  reminderHour: whole('REMINDER_HOUR', 9),
  undoSeconds: whole('UNDO_SECONDS', 10),
  waitTickSeconds: whole('WAIT_TICK_SECONDS', 60),
  uploadMaxMb: whole('UPLOAD_MAX_MB', 10),
  bookingRatePerMinute: whole('BOOKING_RATE_PER_MINUTE', 10),
  vatPercent: whole('VAT_PERCENT', 20),
  idempotencyKeyHours: whole('IDEMPOTENCY_KEY_HOURS', 24),
} as const;

export const clinicHours = { openMinute: 8 * 60, closeMinute: 18 * 60 } as const;
