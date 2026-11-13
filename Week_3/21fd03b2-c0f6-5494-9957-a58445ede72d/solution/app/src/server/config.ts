function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the environment`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || "4173");

/** The one place the environment is read. Nothing here is logged or sent to the browser. */
export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    pathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  valkeyUrl: required("VALKEY_URL"),
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: required("MAIL_FROM") },
  lockTtlSeconds: seconds("LOCK_TTL_SECONDS", 30),
  presenceTtlSeconds: seconds("PRESENCE_TTL_SECONDS", 20),
  inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604800),
  shareLinkTtlSeconds: seconds("SHARE_LINK_TTL_SECONDS", 2592000),
} as const;
