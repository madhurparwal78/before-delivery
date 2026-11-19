function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export const config = {
  port: int('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    smtpHost: required('SMTP_HOST'),
    smtpPort: int('SMTP_PORT', 1025),
    mailpitUrl: optional('MAILPIT_URL'),
    from: required('MAIL_FROM'),
  },
  gradingToken: optional('GRADING_TOKEN'),
  limits: {
    seatHoldSeconds: int('SEAT_HOLD_SECONDS', 300),
    requestExpiryHours: int('REQUEST_EXPIRY_HOURS', 12),
    requestCutoffMinutes: int('REQUEST_CUTOFF_MINUTES', 60),
    bookingCutoffMinutes: int('BOOKING_CUTOFF_MINUTES', 30),
    refundFullHours: int('REFUND_FULL_HOURS', 24),
    refundHalfHours: int('REFUND_HALF_HOURS', 2),
    refundHalfPercent: int('REFUND_HALF_PERCENT', 50),
    freeCancelShiftMinutes: int('FREE_CANCEL_SHIFT_MINUTES', 60),
    ratingWindowDays: int('RATING_WINDOW_DAYS', 14),
    messageRatePerMinute: int('MESSAGE_RATE_PER_MINUTE', 20),
    requestRatePerHour: int('REQUEST_RATE_PER_HOUR', 5),
    signinCodeRatePerHour: int('SIGNIN_CODE_RATE_PER_HOUR', 5),
    emailCodeTtlSeconds: int('EMAIL_CODE_TTL_SECONDS', 600),
    photoMaxBytes: int('PHOTO_MAX_BYTES', 2_097_152),
    idDocMaxBytes: int('ID_DOC_MAX_BYTES', 5_242_880),
    priceMinPerKmCents: int('PRICE_MIN_PER_KM_CENTS', 8),
    priceMaxPerKmCents: int('PRICE_MAX_PER_KM_CENTS', 13),
    maxStopovers: int('MAX_STOPOVERS', 3),
    averageSpeedKmh: int('AVERAGE_SPEED_KMH', 80),
    toastSeconds: int('TOAST_SECONDS', 5),
    searchDebounceMs: int('SEARCH_DEBOUNCE_MS', 300),
  },
} as const;

export type Limits = typeof config.limits;

export const MAX_JSON_BYTES = 65_536;
export const MAX_UPLOAD_BYTES = config.limits.idDocMaxBytes + MAX_JSON_BYTES;
