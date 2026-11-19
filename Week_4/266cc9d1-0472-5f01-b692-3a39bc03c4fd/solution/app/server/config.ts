// Every setting the server needs, read once from the process environment at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value.trim();
}

function positiveWhole(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    if (fallback === undefined) throw new Error(`Environment variable ${name} is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive whole number`);
  }
  return value;
}

const port = positiveWhole("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: positiveWhole("SMTP_PORT"),
    from: required("MAIL_FROM"),
  },
  reviewLinkTtlSeconds: positiveWhole("REVIEW_LINK_TTL_SECONDS", 1_209_600),
} as const;
