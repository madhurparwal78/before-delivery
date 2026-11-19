/** Environment-driven configuration (DP-40). */
export interface Config {
  instanceId: string;
  publicBaseUrl: string;
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string; region: string; bucket: string; forcePathStyle: boolean;
    accessKeyId: string; secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  killbill: {
    url: string; username: string; password: string;
    apiKey: string; apiSecret: string;
  };
  joinLinkGraceSeconds: number;
  deliveryRetrySeconds: number;
  paymentGraceSeconds: number;
  trashPurgeSeconds: number;
  signinWindowSeconds: number;
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = num(env.APP_PUBLIC_PORT, 4173);
  const publicBaseUrl = env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.length > 0
    ? env.PUBLIC_BASE_URL.replace(/\/+$/, '')
    : `http://localhost:${port}`;
  return {
    instanceId: env.INSTANCE_ID && env.INSTANCE_ID.length > 0 ? env.INSTANCE_ID : 'a',
    publicBaseUrl,
    port,
    databaseUrl: env.DATABASE_URL ?? '',
    s3: {
      endpoint: env.S3_ENDPOINT ?? '',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? '',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: { host: env.SMTP_HOST ?? '', port: num(env.SMTP_PORT, 1025), from: env.MAIL_FROM ?? '' },
    killbill: {
      url: (env.KILLBILL_URL ?? '').replace(/\/+$/, ''),
      username: env.KILLBILL_USERNAME ?? '',
      password: env.KILLBILL_PASSWORD ?? '',
      apiKey: env.KILLBILL_API_KEY ?? '',
      apiSecret: env.KILLBILL_API_SECRET ?? '',
    },
    joinLinkGraceSeconds: num(env.JOIN_LINK_GRACE_SECONDS, 86400),
    deliveryRetrySeconds: num(env.DELIVERY_RETRY_SECONDS, 15),
    paymentGraceSeconds: num(env.PAYMENT_GRACE_SECONDS, 604800),
    trashPurgeSeconds: num(env.TRASH_PURGE_SECONDS, 2592000),
    signinWindowSeconds: num(env.SIGNIN_WINDOW_SECONDS, 900),
  };
}
