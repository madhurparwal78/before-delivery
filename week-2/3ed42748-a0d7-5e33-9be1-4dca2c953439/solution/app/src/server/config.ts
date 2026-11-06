// The one place the environment is read. Values are taken once, at start.

function positiveSeconds(name: string, fallback: number, lowest: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(lowest, value);
}

function required(name: string): string {
  return process.env[name] ?? "";
}

const port = Number(process.env.APP_PUBLIC_PORT) || 4173;
const publicUrl = (process.env.APP_PUBLIC_URL ?? "").trim();


export const config = {
  port,
  base: (publicUrl || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom: required("MAIL_FROM"),
  postboxKeyTtlSeconds: positiveSeconds("POSTBOX_KEY_TTL_SECONDS", 900, 5),
  rushHoldSeconds: positiveSeconds("RUSH_HOLD_SECONDS", 600, 4),
  mailWindowSeconds: positiveSeconds("POSTCARD_MAIL_WINDOW_SECONDS", 600, 20),
};
