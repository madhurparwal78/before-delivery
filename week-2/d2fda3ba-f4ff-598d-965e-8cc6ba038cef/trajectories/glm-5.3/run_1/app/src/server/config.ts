const i = (v: string | undefined, d: number): number => (v && v.trim() !== '' ? Number(v) : d);

export const port = i(process.env.APP_PUBLIC_PORT, 4173);

const publicUrl = (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');

export const config = {
  port,
  publicUrl,
  db: process.env.DATABASE_URL ?? '',
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: i(process.env.SMTP_PORT, 1025),
    from: process.env.MAIL_FROM ?? 'Cairn <no-reply@cairn.example>',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  killbill: {
    url: (process.env.KILLBILL_URL ?? '').replace(/\/+$/, ''),
    username: process.env.KILLBILL_USERNAME ?? '',
    password: process.env.KILLBILL_PASSWORD ?? '',
    apiKey: process.env.KILLBILL_API_KEY ?? '',
    apiSecret: process.env.KILLBILL_API_SECRET ?? '',
  },
  timers: {
    deviceApprovalTtl: i(process.env.CAIRN_DEVICE_APPROVAL_TTL_SECONDS, 1800),
    inviteTtl: i(process.env.CAIRN_INVITE_TTL_SECONDS, 604800),
    previewTtl: i(process.env.CAIRN_PREVIEW_TTL_SECONDS, 259200),
    idempotencyTtl: i(process.env.CAIRN_IDEMPOTENCY_TTL_SECONDS, 86400),
    syncGrace: process.env.CAIRN_SYNC_GRACE_SECONDS ? i(process.env.CAIRN_SYNC_GRACE_SECONDS, 0) : undefined,
    publishRetention: process.env.CAIRN_PUBLISH_RETENTION_SECONDS ? i(process.env.CAIRN_PUBLISH_RETENTION_SECONDS, 0) : undefined,
    publishWarningLead: process.env.CAIRN_PUBLISH_WARNING_LEAD_SECONDS ? i(process.env.CAIRN_PUBLISH_WARNING_LEAD_SECONDS, 0) : undefined,
    sweepInterval: i(process.env.CAIRN_SWEEP_INTERVAL_SECONDS, 30),
  },
} as const;

export const syncGraceSeconds = (): number | undefined =>
  config.timers.syncGrace !== undefined && config.timers.syncGrace > 0 ? config.timers.syncGrace : undefined;

export const publishRetentionSeconds = (): number | undefined =>
  config.timers.publishRetention !== undefined && config.timers.publishRetention > 0 ? config.timers.publishRetention : undefined;

export const publishWarningLeadSeconds = (): number =>
  config.timers.publishWarningLead !== undefined && config.timers.publishWarningLead > 0
    ? config.timers.publishWarningLead
    : 3 * 24 * 3600;
