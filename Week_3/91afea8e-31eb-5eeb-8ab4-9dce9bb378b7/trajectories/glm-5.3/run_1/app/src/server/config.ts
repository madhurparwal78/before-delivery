export const SECOND_MS = 1000;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export const config = {
  port: num("APP_PUBLIC_PORT", 4173),
  databaseUrl: str("DATABASE_URL", "postgresql://localhost:5432/postgres"),
  s3: {
    endpoint: str("S3_ENDPOINT", ""),
    region: str("S3_REGION", "us-east-1"),
    bucket: str("S3_BUCKET", "chauraha"),
    forcePathStyle: str("S3_FORCE_PATH_STYLE", "true") !== "false",
    accessKeyId: str("S3_ACCESS_KEY_ID", ""),
    secretAccessKey: str("S3_SECRET_ACCESS_KEY", ""),
  },
  killbill: {
    url: str("KILLBILL_URL", "").replace(/\/+$/, ""),
    username: str("KILLBILL_USERNAME", ""),
    password: str("KILLBILL_PASSWORD", ""),
    apiKey: str("KILLBILL_API_KEY", ""),
    apiSecret: str("KILLBILL_API_SECRET", ""),
  },
  meilisearch: {
    url: str("MEILISEARCH_URL", "").replace(/\/+$/, ""),
    apiKey: str("MEILISEARCH_API_KEY", ""),
    index: str("SEARCH_INDEX", "listings"),
  },
  wiremock: {
    url: str("WIREMOCK_URL", "").replace(/\/+$/, ""),
  },
  timing: {
    otpTtlSeconds: num("OTP_TTL_SECONDS", 300),
    codeWindowSeconds: num("CODE_WINDOW_SECONDS", 900),
    codeResendSeconds: num("CODE_RESEND_SECONDS", 30),
    accessTtlSeconds: num("ACCESS_TTL_SECONDS", 900),
    sessionTtlSeconds: num("SESSION_TTL_SECONDS", 2592000),
    upiExpirySeconds: num("UPI_EXPIRY_SECONDS", 600),
    shareTtlSeconds: num("SHARE_TTL_SECONDS", 2592000),
    rateWindowSeconds: num("RATE_WINDOW_SECONDS", 60),
    idempotencyTtlSeconds: num("IDEMPOTENCY_TTL_SECONDS", 86400),
  },
  limits: {
    jsonBodyBytes: 65536,
    multipartBodyBytes: 5300000,
    photoBytes: 2000000,
    certificateBytes: 5000000,
    photoCount: 6,
    liveListings: 200,
    cartLines: 10,
    savedLines: 50,
    lineQuantity: 10,
    wishlistItems: 100,
    codCapPaise: 5000000,
    openCodOrders: 3,
    pageSize: 24,
    offersPerPage: 10,
    compareMax: 4,
    compareMin: 2,
  },
} as const;
