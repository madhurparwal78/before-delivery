const num = (name: string, dflt: number): number => {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

export const settings = {
  slotMinutes: num('SLOT_MINUTES', 15),
  lateMinutes: num('LATE_MINUTES', 10),
  treatmentGraceMinutes: num('TREATMENT_GRACE_MINUTES', 15),
  admissionLingerHours: num('ADMISSION_LINGER_HOURS', 12),
  bookingLeadMinutes: num('BOOKING_LEAD_MINUTES', 30),
  bookingHorizonDays: num('BOOKING_HORIZON_DAYS', 28),
  reminderLeadDays: num('REMINDER_LEAD_DAYS', 28),
  reminderHour: num('REMINDER_HOUR', 9),
  undoSeconds: num('UNDO_SECONDS', 10),
  waitTickSeconds: num('WAIT_TICK_SECONDS', 60),
  uploadMaxMb: num('UPLOAD_MAX_MB', 10),
  bookingRatePerMinute: num('BOOKING_RATE_PER_MINUTE', 10),
  vatPercent: num('VAT_PERCENT', 20),
  idempotencyKeyHours: num('IDEMPOTENCY_KEY_HOURS', 24),
  smtpHost: process.env.SMTP_HOST || 'localhost',
  smtpPort: num('SMTP_PORT', 1025),
  mailFrom: process.env.MAIL_FROM || 'Roundbook <no-reply@roundbook.test>',
  mailpitUrl: process.env.MAILPIT_URL || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'us-east-1',
  s3Bucket: process.env.S3_BUCKET || 'roundbook',
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') !== 'false',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  gradingToken: process.env.GRADING_TOKEN || '',
  appPublicPort: process.env.APP_PUBLIC_PORT ? Number(process.env.APP_PUBLIC_PORT) : null,
  appPublicUrl: process.env.APP_PUBLIC_URL || '',
  timeZone: 'Europe/London' as const,
  clinicHours: { start: 8, end: 18 } as const,
};

export const CLINIC_TZ = settings.timeZone;
