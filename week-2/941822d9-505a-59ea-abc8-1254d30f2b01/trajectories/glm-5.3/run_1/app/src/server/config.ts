const optionalSeconds = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: (() => {
    const raw = process.env.APP_PUBLIC_PORT;
    const parsed = raw === undefined || raw === "" ? undefined : Number.parseInt(raw, 10);
    return parsed !== undefined && Number.isFinite(parsed) ? parsed : 4173;
  })(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  killbill: {
    url: process.env.KILLBILL_URL ?? "",
    username: process.env.KILLBILL_USERNAME ?? "",
    password: process.env.KILLBILL_PASSWORD ?? "",
    apiKey: process.env.KILLBILL_API_KEY ?? "",
    apiSecret: process.env.KILLBILL_API_SECRET ?? "",
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: (() => {
      const parsed = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
      return Number.isFinite(parsed) ? parsed : 1025;
    })(),
    from: process.env.MAIL_FROM ?? "Credwell Certificates <certificates@credwell.test>",
  },
  timings: {
    seatExpirySeconds: optionalSeconds("CREDWELL_SEAT_EXPIRY_SECONDS", 12 * 30 * 24 * 60 * 60),
    fullRefundWindowSeconds: optionalSeconds("CREDWELL_FULL_REFUND_WINDOW_SECONDS", 7 * 24 * 60 * 60),
    shareLinkTtlSeconds: optionalSeconds("CREDWELL_SHARE_LINK_TTL_SECONDS", 90 * 24 * 60 * 60),
    downloadLinkTtlSeconds: optionalSeconds("CREDWELL_DOWNLOAD_LINK_TTL_SECONDS", 7 * 24 * 60 * 60),
    sealRetrySeconds: optionalSeconds("CREDWELL_SEAL_RETRY_SECONDS", 15),
  },
};

export const PROVIDER = {
  name: "Sorrel & Pike Learning",
  slug: "sorrel-pike",
  timezone: "America/Chicago" as const,
  accreditation:
    "Sorrel & Pike Learning is approved as a provider of nursing continuing professional development by the Meridian Council for Nursing Education.",
};
