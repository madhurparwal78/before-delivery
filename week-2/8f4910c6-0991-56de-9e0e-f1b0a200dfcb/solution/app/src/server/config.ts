// The one place that reads the environment. Only the brief's documented defaults exist here.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  baseUrl: (process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  optionChallengeSeconds: seconds("OPTION_CHALLENGE_SECONDS", 14_400),
  packageLinkTtlSeconds: seconds("PACKAGE_LINK_TTL_SECONDS", 1_209_600),
  consentLinkTtlSeconds: seconds("CONSENT_LINK_TTL_SECONDS", 604_800),
  sessionTtlSeconds: seconds("SESSION_TTL_SECONDS", 28_800),
};
