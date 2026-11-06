// The one configuration module: every service address and credential comes from the environment at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  escalationSeconds: seconds("ESCALATION_SECONDS", 300),
  signInWindowSeconds: seconds("SIGN_IN_WINDOW_SECONDS", 900),
};
