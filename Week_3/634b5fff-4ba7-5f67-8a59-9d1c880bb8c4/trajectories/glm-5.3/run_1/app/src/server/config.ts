function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}
function num(name: string, fallback?: number): number | undefined {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const namespace = env('PRESS_NAMESPACE') ?? '';

export const config = {
  port: Number(env('APP_PUBLIC_PORT') ?? 4173),
  databaseUrl: env('DATABASE_URL') ?? 'postgresql://localhost/gf_dev',
  killbill: {
    url: env('KILLBILL_URL') ?? 'http://localhost:8080',
    username: env('KILLBILL_USERNAME') ?? 'admin',
    password: env('KILLBILL_PASSWORD') ?? 'password',
    apiKey: env('KILLBILL_API_KEY') ?? '',
    apiSecret: env('KILLBILL_API_SECRET') ?? '',
  },
  wiremockUrl: env('WIREMOCK_URL') ?? 'http://localhost:8080',
  keycloak: {
    url: env('KEYCLOAK_URL') ?? 'http://localhost:8080',
    realm: env('KEYCLOAK_REALM') ?? 'gf-dev',
    issuerUrl: env('AUTH_ISSUER_URL') ?? '',
    clientId: env('AUTH_CLIENT_ID') ?? '',
    clientSecret: env('AUTH_CLIENT_SECRET') ?? '',
  },
  valkeyUrl: env('VALKEY_URL') ?? 'redis://localhost:6379/0',
  amqpUrl: env('AMQP_URL') ?? 'amqp://localhost/%2F',
  meilisearch: {
    url: env('MEILISEARCH_URL') ?? 'http://localhost:7700',
    apiKey: env('MEILISEARCH_API_KEY') ?? '',
  },
  s3: {
    endpoint: env('S3_ENDPOINT') ?? 'http://localhost:9000',
    region: env('S3_REGION') ?? 'us-east-1',
    bucket: env('S3_BUCKET') ?? 'gf-dev',
    forcePathStyle: (env('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
    accessKeyId: env('S3_ACCESS_KEY_ID') ?? '',
    secretAccessKey: env('S3_SECRET_ACCESS_KEY') ?? '',
  },
  gotenbergUrl: env('GOTENBERG_URL') ?? 'http://localhost:3000',
  smtp: {
    host: env('SMTP_HOST') ?? 'localhost',
    port: Number(env('SMTP_PORT') ?? 1025),
    from: env('MAIL_FROM') ?? 'Svovlstik Press <press@svovlstik.example>',
  },
  svix: {
    url: env('SVIX_URL') ?? 'http://localhost:8071',
    apiKey: env('SVIX_API_KEY') ?? '',
  },
  ntfy: {
    url: env('NTFY_URL') ?? 'http://localhost',
    username: env('NTFY_USERNAME'),
    password: env('NTFY_PASSWORD'),
  },
  appPublicUrl: env('APP_PUBLIC_URL') ?? 'http://127.0.0.1:4173',
  holdSeconds: num('HOLD_SECONDS', 600)!,
  authSeconds: num('AUTH_SECONDS', 604800)!,
  challengeSeconds: num('CHALLENGE_SECONDS', 300)!,
  transferSeconds: num('TRANSFER_SECONDS'),
  lookupWindowSeconds: num('LOOKUP_WINDOW_SECONDS', 900)!,
  lowStockThresholds: (env('LOW_STOCK_THRESHOLDS') ?? '24,5').split(',').map(Number).filter(Number.isFinite),
  namespace,
  pressClockStart: env('PRESS_CLOCK_START'),
  gatewayCallbackSecret: env('GATEWAY_CALLBACK_SECRET') ?? 'sbx_gateway_callback_secret_01',
  charityWebhookSecret: env('CHARITY_WEBHOOK_SECRET') ?? 'whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz',
  charityWebhookUrl: env('CHARITY_WEBHOOK_URL'),
} as const;

export function ns(name: string): string {
  return namespace ? `${namespace}-${name}` : name;
}

export function holdKey(number: number): string {
  return `${ns('hold')}:${number}`;
}

export function lookupKey(client: string): string {
  return `${ns('lookup')}:${client}`;
}

/** One place for business-clock decisions. The business clock starts at
 * PRESS_CLOCK_START (if set) when the process boots and then runs normally.
 * Durations (hold, challenge, authorisation, lookup, TRANSFER_SECONDS
 * deadline) and callback staleness always use the real clock. */
export class BusinessClock {
  private readonly bootMs: number;
  private readonly startMs: number | null;

  constructor(startIso: string | undefined, bootMs = Date.now()) {
    this.bootMs = bootMs;
    this.startMs = startIso ? Date.parse(startIso) : null;
  }

  now(): Date {
    if (this.startMs === null) return new Date();
    return new Date(this.startMs + (Date.now() - this.bootMs));
  }

  nowMs(): number {
    return this.now().getTime();
  }
}

export const businessClock = new BusinessClock(config.pressClockStart);
