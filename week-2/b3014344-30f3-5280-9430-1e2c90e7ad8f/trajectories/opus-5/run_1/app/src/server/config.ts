function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid ${name}`);
  return parsed;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? "4173"),
  publicUrl: required("APP_PUBLIC_URL"),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  cms: {
    url: required("POCKETBASE_URL"),
    adminEmail: required("POCKETBASE_ADMIN_EMAIL"),
    adminPassword: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  killbill: {
    url: required("KILLBILL_URL"),
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
  durations: {
    dunningDaySeconds: seconds("DUNNING_DAY_SECONDS", 86400),
    downloadLinkSeconds: seconds("DOWNLOAD_LINK_SECONDS", 60),
    previewTtlSeconds: seconds("PREVIEW_TTL_SECONDS", 600),
    inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604800),
  },
} as const;

export const STUDIO_ZONE = "America/Argentina/Buenos_Aires";
export const SESSION_COOKIE = "pampero_session";
export const MAX_JSON_BYTES = 65536;
export const MAX_UPLOAD_REQUEST_BYTES = 10_100_000;
export const MAX_FILE_BYTES = 10_000_000;
