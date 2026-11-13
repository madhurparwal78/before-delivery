function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

interface Config {
  port: number;
  publicUrl: string;
  mailFrom: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    pathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  valkeyUrl: string;
  amqpUrl: string;
  smtp: { host: string; port: number };
  mailGroupSeconds: number;
  outboxRetrySeconds: number;
  manifestLinkSeconds: number;
  exportQueue: string;
  exportStepMs: number;
  exportMinuteAllowance: number;
  storageAllowanceBytes: number;
}

function loadConfig(): Config {
  const port = integer("APP_PUBLIC_PORT", 4173);
  return {
    port,
    publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
    mailFrom: required("MAIL_FROM"),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      pathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    valkeyUrl: required("VALKEY_URL"),
    amqpUrl: required("AMQP_URL"),
    smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 25) },
    mailGroupSeconds: integer("MAIL_GROUP_SECONDS", 60),
    outboxRetrySeconds: integer("OUTBOX_RETRY_SECONDS", 10),
    manifestLinkSeconds: integer("MANIFEST_LINK_SECONDS", 900),
    exportQueue: process.env["EXPORT_QUEUE"] || "gatecut.exports",
    exportStepMs: integer("EXPORT_STEP_MS", 400),
    exportMinuteAllowance: integer("EXPORT_MINUTE_ALLOWANCE", 600),
    storageAllowanceBytes: integer("STORAGE_ALLOWANCE_BYTES", 100_000_000_000),
  };
}

export const config: Config = loadConfig();
