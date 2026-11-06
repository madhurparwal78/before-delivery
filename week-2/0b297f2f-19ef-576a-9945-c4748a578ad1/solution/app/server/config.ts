// The one place the environment is read (brief: Configuration and secrets).
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);
const delay = process.env.PREVIEW_PUBLISH_DELAY_SECONDS;

export const config = {
  port,
  publicBase: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: required("MAIL_FROM"),
  publishDelaySeconds: delay !== undefined && delay !== "" ? Number(delay) : null,
} as const;
