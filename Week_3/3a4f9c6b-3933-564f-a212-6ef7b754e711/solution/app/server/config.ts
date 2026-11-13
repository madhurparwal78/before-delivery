// Every setting the server reads, from the environment variables the brief names.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  approvalTtlSeconds: seconds("KEELSON_APPROVAL_TTL_SECONDS", 14_400),
  sessionTtlSeconds: seconds("KEELSON_SESSION_TTL_SECONDS", 43_200),
  requestKeyTtlSeconds: seconds("KEELSON_REQUEST_KEY_TTL_SECONDS", 86_400),
};
