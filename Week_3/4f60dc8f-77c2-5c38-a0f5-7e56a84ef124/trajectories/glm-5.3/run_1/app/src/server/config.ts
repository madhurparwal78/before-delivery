export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    port: number;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  mail: {
    smtpHost: string;
    smtpPort: number;
    mailpitUrl: string;
    from: string;
  };
  pocketbase: {
    url: string;
    adminEmail: string;
    adminPassword: string;
  };
  amqpUrl: string;
  gotenbergUrl: string;
  meilisearch: {
    url: string;
    apiKey: string;
  };
  ntfy: {
    url: string;
    username: string;
    password: string;
    topic: string;
  };
  timers: {
    signinCodeTtlSeconds: number;
    signinCodeWindowSeconds: number;
    reviewLinkTtlSeconds: number;
    overdueAfterSeconds: number;
    idempotencyKeyTtlSeconds: number;
  };
  studioPassword: string;
}

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

function envRequired(name: string): string {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const port = intEnv('APP_PUBLIC_PORT', 4173);
  const publicUrl = (env('APP_PUBLIC_URL') ?? `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  const s3Endpoint = envRequired('S3_ENDPOINT');
  const s3Url = new URL(s3Endpoint);
  return {
    port,
    publicUrl,
    databaseUrl: envRequired('DATABASE_URL'),
    s3: {
      endpoint: s3Url.hostname,
      port: s3Url.port ? Number.parseInt(s3Url.port, 10) : (s3Url.protocol === 'https:' ? 443 : 80),
      region: env('S3_REGION', 'us-east-1') as string,
      bucket: envRequired('S3_BUCKET'),
      forcePathStyle: env('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: envRequired('S3_ACCESS_KEY_ID'),
      secretAccessKey: envRequired('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: envRequired('KILLBILL_URL').replace(/\/+$/, ''),
      username: envRequired('KILLBILL_USERNAME'),
      password: envRequired('KILLBILL_PASSWORD'),
      apiKey: envRequired('KILLBILL_API_KEY'),
      apiSecret: envRequired('KILLBILL_API_SECRET'),
    },
    mail: {
      smtpHost: envRequired('SMTP_HOST'),
      smtpPort: intEnv('SMTP_PORT', 1025),
      mailpitUrl: envRequired('MAILPIT_URL').replace(/\/+$/, ''),
      from: env('MAIL_FROM', 'Gloamwork Studio <studio@gloamwork.test>') as string,
    },
    pocketbase: {
      url: envRequired('POCKETBASE_URL').replace(/\/+$/, ''),
      adminEmail: envRequired('POCKETBASE_ADMIN_EMAIL'),
      adminPassword: envRequired('POCKETBASE_ADMIN_PASSWORD'),
    },
    amqpUrl: envRequired('AMQP_URL'),
    gotenbergUrl: envRequired('GOTENBERG_URL').replace(/\/+$/, ''),
    meilisearch: {
      url: envRequired('MEILISEARCH_URL').replace(/\/+$/, ''),
      apiKey: envRequired('MEILISEARCH_API_KEY'),
    },
    ntfy: {
      url: envRequired('NTFY_URL').replace(/\/+$/, ''),
      username: envRequired('NTFY_USERNAME'),
      password: envRequired('NTFY_PASSWORD'),
      topic: 'gloamwork-studio',
    },
    timers: {
      signinCodeTtlSeconds: intEnv('SIGNIN_CODE_TTL_SECONDS', 600),
      signinCodeWindowSeconds: intEnv('SIGNIN_CODE_WINDOW_SECONDS', 900),
      reviewLinkTtlSeconds: intEnv('REVIEW_LINK_TTL_SECONDS', 1209600),
      overdueAfterSeconds: intEnv('OVERDUE_AFTER_SECONDS', 1209600),
      idempotencyKeyTtlSeconds: intEnv('IDEMPOTENCY_KEY_TTL_SECONDS', 86400),
    },
    studioPassword: env('STUDIO_PASSWORD', 'rig-founder-2026') as string,
  };
}
