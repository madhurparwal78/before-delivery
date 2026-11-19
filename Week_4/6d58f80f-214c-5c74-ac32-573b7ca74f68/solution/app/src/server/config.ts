// The one place the server reads its environment (brief: Configuration and secrets).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  directory: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    adminEmail: required("POCKETBASE_ADMIN_EMAIL"),
    adminPassword: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  quotaBytes: whole("STORAGE_QUOTA_BYTES", 100_000_000_000),
  uploadPauseTtlSeconds: whole("UPLOAD_PAUSE_TTL_SECONDS", 86_400),
  clockControl: process.env.LINTEL_CLOCK_CONTROL === "on",
} as const;
