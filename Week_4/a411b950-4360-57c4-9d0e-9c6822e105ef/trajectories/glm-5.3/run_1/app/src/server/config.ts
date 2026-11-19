/**
 * Earshot configuration. Every service URL and credential is read from the
 * environment (DP-45); nothing here is hard-coded and none of it is ever sent
 * to the browser.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: {
    host: string;
    port: number;
    from: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  proposalLinkTtlSeconds: number;
  enquiryLimits: {
    perSender: number;
    perIp: number;
    windowSeconds: number;
  };
  mailRetrySeconds: number;
}

export function loadConfig(): AppConfig {
  const port = integer("APP_PUBLIC_PORT", 4173, 1, 65535);
  const publicUrl = (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    port,
    publicUrl,
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: {
      host: required("SMTP_HOST"),
      port: integer("SMTP_PORT", 1025, 1, 65535),
      from: required("MAIL_FROM"),
    },
    killbill: {
      url: required("KILLBILL_URL").replace(/\/+$/, ""),
      username: required("KILLBILL_USERNAME"),
      password: required("KILLBILL_PASSWORD"),
      apiKey: required("KILLBILL_API_KEY"),
      apiSecret: required("KILLBILL_API_SECRET"),
    },
    proposalLinkTtlSeconds: integer("PROPOSAL_LINK_TTL_SECONDS", 1209600, 1, 100 * 365 * 24 * 3600),
    enquiryLimits: {
      perSender: integer("ENQUIRY_LIMIT_PER_SENDER", 3, 1, 100000),
      perIp: integer("ENQUIRY_LIMIT_PER_IP", 200, 1, 1000000),
      windowSeconds: integer("ENQUIRY_RATE_WINDOW_SECONDS", 600, 1, 1000000),
    },
    mailRetrySeconds: integer("MAIL_RETRY_SECONDS", 10, 1, 3600),
  };
}
