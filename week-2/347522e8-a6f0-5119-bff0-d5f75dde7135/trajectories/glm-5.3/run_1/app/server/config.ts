const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const str = (name: string, fallback: string): string => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw;
};

export const config = {
  publicPort: int("APP_PUBLIC_PORT", 4173),
  databaseUrl: str("DATABASE_URL", ""),
  killbill: {
    url: str("KILLBILL_URL", ""),
    username: str("KILLBILL_USERNAME", ""),
    password: str("KILLBILL_PASSWORD", ""),
    apiKey: str("KILLBILL_API_KEY", ""),
    apiSecret: str("KILLBILL_API_SECRET", ""),
  },
  smtp: {
    host: str("SMTP_HOST", ""),
    port: int("SMTP_PORT", 1025),
    mailFrom: str("MAIL_FROM", ""),
  },
  s3: {
    endpoint: str("S3_ENDPOINT", ""),
    region: str("S3_REGION", "us-east-1"),
    bucket: str("S3_BUCKET", ""),
    forcePathStyle: str("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: str("S3_ACCESS_KEY_ID", ""),
    secretAccessKey: str("S3_SECRET_ACCESS_KEY", ""),
  },
  holdTtlSeconds: int("HOLD_TTL_SECONDS", 600),
  complianceScanSeconds: int("COMPLIANCE_SCAN_SECONDS", 60),
  outboxRetrySeconds: int("OUTBOX_RETRY_SECONDS", 30),
  kitchenTimeZone: "America/Chicago" as const,
};
