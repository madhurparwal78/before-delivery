// The one place the server reads its environment (Configuration and secrets).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function optionalSeconds(name: string, range: [number, number] = [1, Number.MAX_SAFE_INTEGER]): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
    throw new Error(`${name} must be a whole number of seconds from ${range[0]} to ${range[1]}`);
  }
  return value;
}

function seconds(name: string, fallback: number, range?: [number, number]): number {
  return optionalSeconds(name, range) ?? fallback;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
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
  },
  timers: {
    deviceApprovalTtl: seconds("CAIRN_DEVICE_APPROVAL_TTL_SECONDS", 1800),
    inviteTtl: seconds("CAIRN_INVITE_TTL_SECONDS", 604800),
    previewTtl: seconds("CAIRN_PREVIEW_TTL_SECONDS", 259200),
    idempotencyTtl: seconds("CAIRN_IDEMPOTENCY_TTL_SECONDS", 86400),
    syncGrace: optionalSeconds("CAIRN_SYNC_GRACE_SECONDS"),
    publishRetention: optionalSeconds("CAIRN_PUBLISH_RETENTION_SECONDS"),
    publishWarningLead: optionalSeconds("CAIRN_PUBLISH_WARNING_LEAD_SECONDS"),
    sweepInterval: seconds("CAIRN_SWEEP_INTERVAL_SECONDS", 30, [1, 60]),
  },
};

export const publicOrigin = new URL(config.publicUrl).origin;
