// The one place the environment is read. Values are read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? Number(raw) : fallback;
}

function mailbox(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

const mailFrom = required("MAIL_FROM");

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
  overduePollSeconds: seconds("OVERDUE_POLL_SECONDS", 15),
  finalNoticeSeconds: seconds("DUNNING_FINAL_NOTICE_SECONDS", 259_200),
  inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604_800),
  databaseUrl: required("DATABASE_URL"),
  keycloak: {
    url: required("KEYCLOAK_URL").replace(/\/$/, ""),
    realm: required("KEYCLOAK_REALM"),
    issuer: required("AUTH_ISSUER_URL").replace(/\/$/, ""),
    clientId: required("AUTH_CLIENT_ID"),
    clientSecret: required("AUTH_CLIENT_SECRET"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  valkeyUrl: required("VALKEY_URL"),
  svix: { url: required("SVIX_URL").replace(/\/$/, ""), apiKey: required("SVIX_API_KEY") },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: mailFrom, envelopeFrom: mailbox(mailFrom) },
} as const;
