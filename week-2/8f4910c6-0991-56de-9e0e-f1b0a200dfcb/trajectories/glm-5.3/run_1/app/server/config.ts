import path from "node:path";

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value === undefined || value === "" || !Number.isFinite(parsed) ? fallback : parsed;
}

const port = num(process.env.APP_PUBLIC_PORT, 4173);

export const config = {
  port,
  baseUrl: process.env.APP_BASE_URL || process.env.APP_PUBLIC_URL || `http://127.0.0.1:${port}`,
  databaseUrl: process.env.DATABASE_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() !== "false",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  killbill: {
    url: process.env.KILLBILL_URL || "",
    username: process.env.KILLBILL_USERNAME || "admin",
    password: process.env.KILLBILL_PASSWORD || "password",
    apiKey: process.env.KILLBILL_API_KEY || "rungboard",
    apiSecret: process.env.KILLBILL_API_SECRET || "",
  },
  smtp: {
    host: process.env.SMTP_HOST || "localhost",
    port: num(process.env.SMTP_PORT, 1025),
    mailFrom: process.env.MAIL_FROM || "Vesper & Rowe Talent <bookings@vesperrowe.example>",
  },
  optionChallengeSeconds: num(process.env.OPTION_CHALLENGE_SECONDS, 14400),
  packageLinkTtlSeconds: num(process.env.PACKAGE_LINK_TTL_SECONDS, 1209600),
  consentLinkTtlSeconds: num(process.env.CONSENT_LINK_TTL_SECONDS, 604800),
  sessionTtlSeconds: num(process.env.SESSION_TTL_SECONDS, 28800),
  staticDir: path.resolve("public-static"),
};
