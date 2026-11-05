// Every credential, address and duration comes from the environment, read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  dunningDaySeconds: seconds("DUNNING_DAY_SECONDS", 86_400),
  downloadLinkSeconds: seconds("DOWNLOAD_LINK_SECONDS", 60),
  previewTtlSeconds: seconds("PREVIEW_TTL_SECONDS", 600),
  inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604_800),
} as const;
