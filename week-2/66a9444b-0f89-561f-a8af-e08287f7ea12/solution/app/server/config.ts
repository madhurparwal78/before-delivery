// The one configuration module: every service URL, credential and time rule is read here, from the
// environment variables the brief names, and nowhere else.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

function senderAddress(from: string): string {
  const open = from.indexOf("<");
  return open >= 0 ? from.slice(open + 1, from.indexOf(">", open)).trim() : from.trim();
}

const mailFrom = required("MAIL_FROM");

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  databaseUrl: required("DATABASE_URL"),
  appSecret: process.env.APP_SECRET || null,
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  mail: {
    smtpHost: required("SMTP_HOST"),
    smtpPort: Number(required("SMTP_PORT")),
    mailpitUrl: required("MAILPIT_URL").replace(/\/+$/, ""),
    from: mailFrom,
    fromAddress: senderAddress(mailFrom),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  time: {
    holdSeconds: seconds("HOLD_SECONDS", 600),
    waitlistClaimSeconds: seconds("WAITLIST_CLAIM_SECONDS", 7200),
    proofDecisionSeconds: seconds("PROOF_DECISION_SECONDS", 259200),
    billingDaySeconds: seconds("BILLING_DAY_SECONDS", 86400),
    signedReadSeconds: seconds("SIGNED_READ_SECONDS", 60),
  },
} as const;
