/** The single place environment variables are read. */

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const parsed = Number.parseInt(text(name, String(fallback)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: text("DATABASE_URL", ""),
  s3: {
    endpoint: text("S3_ENDPOINT", "").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET", ""),
    accessKeyId: text("S3_ACCESS_KEY_ID", ""),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY", ""),
  },
  gotenbergUrl: text("GOTENBERG_URL", "").replace(/\/+$/, ""),
  smtp: { host: text("SMTP_HOST", "127.0.0.1"), port: whole("SMTP_PORT", 1025) },
  mailFrom: text("MAIL_FROM", "Lowlamp Field Log <packets@lowlamp.test>"),
  signinLockSeconds: whole("SIGNIN_LOCK_SECONDS", 900),
  signinSessionSeconds: whole("SIGNIN_SESSION_SECONDS", 2_592_000),
} as const;

export const LIMITS = {
  syncBodyBytes: 5_000_000,
  bodyBytes: 100_000,
  providerSeconds: 10,
  renderSeconds: 60,
  signinFailures: 5,
} as const;
