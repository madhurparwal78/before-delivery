// The one config module: every service URL, credential and timing is read from the environment at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

export const config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number.parseInt(required("SMTP_PORT"), 10),
    from: required("MAIL_FROM"),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  gotenbergUrl: required("GOTENBERG_URL").replace(/\/+$/, ""),
  minCampaignSeconds: seconds("MIN_CAMPAIGN_SECONDS", 86_400),
  finalWindowSeconds: seconds("FINAL_WINDOW_SECONDS", 86_400),
  fixWindowSeconds: seconds("FIX_WINDOW_SECONDS", 604_800),
  fixNoticeSeconds: seconds("FIX_NOTICE_SECONDS", 172_800),
};

/** The longest campaign the launch gate allows (brief: Deadline and length). */
export const MAX_CAMPAIGN_SECONDS = 5_184_000;
