import { digitsToInteger } from "../shared/digits";

/** The only place the process environment is read. Each getter reads at call time, so providers are read per call. */
function text(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  return value !== undefined && /^\d+$/.test(value) ? digitsToInteger(value) : fallback;
}

export const config = {
  get port() { return whole("APP_PUBLIC_PORT", 4173); },
  get publicUrl() { return text("APP_PUBLIC_URL"); },
  get databaseUrl() { return text("DATABASE_URL"); },
  get gotenbergUrl() { return text("GOTENBERG_URL"); },
  get s3Endpoint() { return text("S3_ENDPOINT"); },
  get s3Region() { return text("S3_REGION"); },
  get s3Bucket() { return text("S3_BUCKET"); },
  get s3ForcePathStyle() { return text("S3_FORCE_PATH_STYLE") === "true"; },
  get s3AccessKeyId() { return text("S3_ACCESS_KEY_ID"); },
  get s3SecretAccessKey() { return text("S3_SECRET_ACCESS_KEY"); },
  get smtpHost() { return text("SMTP_HOST"); },
  get smtpPort() { return whole("SMTP_PORT", 0); },
  get mailFrom() { return text("MAIL_FROM", "Nightroll Desk <desk@nightroll.example>"); },
  get gradingKey() { return text("GRADING_KEY"); },
  get defaultTimeZone() { return text("HOTEL_TIME_ZONE_DEFAULT", "America/Chicago"); },
  get linkTtlSeconds() { return whole("CHECKIN_LINK_TTL_SECONDS", 259200); },
  get photoMaxBytes() { return whole("ID_PHOTO_MAX_BYTES", 5000000); },
  get liveMaxDelayMs() { return whole("LIVE_MAX_DELAY_MS", 2000); },
};

export const JSON_LIMIT_BYTES = 1_000_000;
export const PROVIDER_TIMEOUT_MS = 5000;
