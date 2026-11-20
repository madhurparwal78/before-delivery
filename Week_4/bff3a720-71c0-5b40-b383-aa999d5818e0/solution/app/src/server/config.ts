function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

export const config = {
  port: integer("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  valkeyUrl: required("VALKEY_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: integer("SMTP_PORT", 1025),
    from: process.env.MAIL_FROM || "Longseat <rides@longseat.test>",
  },
  mailpitUrl: required("MAILPIT_URL").replace(/\/+$/, ""),
  gradingToken: process.env.GRADING_TOKEN || null,
  seatHoldSeconds: integer("SEAT_HOLD_SECONDS", 300),
  requestExpiryHours: integer("REQUEST_EXPIRY_HOURS", 12),
  requestCutoffMinutes: integer("REQUEST_CUTOFF_MINUTES", 60),
  bookingCutoffMinutes: integer("BOOKING_CUTOFF_MINUTES", 30),
  refundFullHours: integer("REFUND_FULL_HOURS", 24),
  refundHalfHours: integer("REFUND_HALF_HOURS", 2),
  refundHalfPercent: integer("REFUND_HALF_PERCENT", 50),
  freeCancelShiftMinutes: integer("FREE_CANCEL_SHIFT_MINUTES", 60),
  ratingWindowDays: integer("RATING_WINDOW_DAYS", 14),
  messageRatePerMinute: integer("MESSAGE_RATE_PER_MINUTE", 20),
  requestRatePerHour: integer("REQUEST_RATE_PER_HOUR", 5),
  signinCodeRatePerHour: integer("SIGNIN_CODE_RATE_PER_HOUR", 5),
  emailCodeTtlSeconds: integer("EMAIL_CODE_TTL_SECONDS", 600),
  photoMaxBytes: integer("PHOTO_MAX_BYTES", 2_097_152),
  idDocMaxBytes: integer("ID_DOC_MAX_BYTES", 5_242_880),
  priceMinPerKmCents: integer("PRICE_MIN_PER_KM_CENTS", 8),
  priceMaxPerKmCents: integer("PRICE_MAX_PER_KM_CENTS", 13),
  maxStopovers: integer("MAX_STOPOVERS", 3),
  averageSpeedKmh: integer("AVERAGE_SPEED_KMH", 80),
  toastSeconds: integer("TOAST_SECONDS", 5),
  searchDebounceMs: integer("SEARCH_DEBOUNCE_MS", 300),
} as const;

/** The JSON body limit of the API, including the limit itself. */
export const JSON_LIMIT_BYTES = 65_536;
export const MULTIPART_EXTRA_BYTES = 65_536;
