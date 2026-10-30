// Every setting the app reads, from the environment only (brief: Configuration and secrets).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  baseUrl: (process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  tenderLinkTtlSeconds: seconds("TENDER_LINK_TTL_SECONDS", 1800),
  invitationTtlSeconds: seconds("INVITATION_TTL_SECONDS", 604_800),
  sessionIdleTimeoutSeconds: seconds("SESSION_IDLE_TIMEOUT_SECONDS", 43_200),
  enquiryRateWindowSeconds: seconds("ENQUIRY_RATE_WINDOW_SECONDS", 3600),
};
