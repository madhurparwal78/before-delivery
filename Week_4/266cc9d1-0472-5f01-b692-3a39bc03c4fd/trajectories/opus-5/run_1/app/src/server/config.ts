/** Every configured value comes from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive whole number`);
  }
  return value;
}

const port = optionalNumber("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  reviewLinkTtlSeconds: optionalNumber("REVIEW_LINK_TTL_SECONDS", 1_209_600),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: optionalNumber("SMTP_PORT", 1025),
    from: required("MAIL_FROM"),
  },
} as const;

export const LIMITS = {
  jsonBodyBytes: 65_536,
  manifestBodyBytes: 2_000_000,
  fileBodyBytes: 50_000_000,
  maxManifestFiles: 2_000,
  maxCommentChars: 2_000,
} as const;
