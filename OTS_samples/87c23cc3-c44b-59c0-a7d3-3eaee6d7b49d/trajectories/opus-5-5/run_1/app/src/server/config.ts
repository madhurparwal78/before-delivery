function text(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

const port = integer("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: (text("APP_PUBLIC_URL") || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: text("SMTP_HOST"),
    port: integer("SMTP_PORT", 25),
  },
  mailFrom: text("MAIL_FROM"),
  gradingKey: text("JOINERY_GRADING_KEY"),
  parseDelayMs: integer("JOINERY_PARSE_DELAY_MS", 150),
  liveMaxDelayMs: integer("JOINERY_LIVE_MAX_DELAY_MS", 1000),
  presenceTimeoutSeconds: integer("JOINERY_PRESENCE_TIMEOUT_SECONDS", 30),
  codeTtlSeconds: integer("JOINERY_CODE_TTL_SECONDS", 600),
  shareTtlSeconds: integer("JOINERY_SHARE_TTL_SECONDS", 604800),
  exportLinkTtlSeconds: integer("JOINERY_EXPORT_LINK_TTL_SECONDS", 300),
  exportRateLimit: integer("JOINERY_EXPORT_RATE_LIMIT", 10),
  textLimitBytes: integer("JOINERY_TEXT_LIMIT_BYTES", 200000),
  entityLimit: integer("JOINERY_ENTITY_LIMIT", 200),
  statementLimit: integer("JOINERY_STATEMENT_LIMIT", 1000),
  nestingLimit: integer("JOINERY_NESTING_LIMIT", 32),
  timeZone: text("JOINERY_TIME_ZONE", "UTC") || "UTC",
};

export const parseLimits = {
  textLimitBytes: config.textLimitBytes,
  entityLimit: config.entityLimit,
  statementLimit: config.statementLimit,
};

export const BODY_LIMIT_BYTES = 5_000_000;
