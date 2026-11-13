function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  return raw === undefined ? fallback : Number.parseInt(raw, 10);
}

const namespace = process.env.PRESS_NAMESPACE ?? '';

/** Valkey keys, broker names, indexes, topics and Svix uids take the namespace prefix. */
export function namespaced(name: string): string {
  return namespace === '' ? name : `${namespace}-${name}`;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  wiremockUrl: required('WIREMOCK_URL'),
  keycloak: {
    url: required('KEYCLOAK_URL'),
    realm: required('KEYCLOAK_REALM'),
    issuerUrl: required('AUTH_ISSUER_URL'),
    clientId: required('AUTH_CLIENT_ID'),
    clientSecret: required('AUTH_CLIENT_SECRET'),
  },
  valkeyUrl: required('VALKEY_URL'),
  amqpUrl: required('AMQP_URL'),
  meilisearch: { url: required('MEILISEARCH_URL'), apiKey: required('MEILISEARCH_API_KEY') },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gotenbergUrl: required('GOTENBERG_URL'),
  smtp: { host: required('SMTP_HOST'), port: integer('SMTP_PORT', 1025), from: required('MAIL_FROM') },
  svix: { url: required('SVIX_URL'), apiKey: required('SVIX_API_KEY') },
  ntfy: { url: required('NTFY_URL'), username: optional('NTFY_USERNAME'), password: optional('NTFY_PASSWORD') },
  publicUrl: required('APP_PUBLIC_URL'),
  port: integer('APP_PUBLIC_PORT', 4173),

  holdSeconds: integer('HOLD_SECONDS', 600),
  authSeconds: integer('AUTH_SECONDS', 604800),
  challengeSeconds: integer('CHALLENGE_SECONDS', 300),
  transferSeconds: optional('TRANSFER_SECONDS') === undefined ? null : integer('TRANSFER_SECONDS', 0),
  lookupWindowSeconds: integer('LOOKUP_WINDOW_SECONDS', 900),
  lowStockThresholds: (optional('LOW_STOCK_THRESHOLDS') ?? '24,5')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10)),
  namespace,
  clockStart: optional('PRESS_CLOCK_START') ?? null,
  gatewayCallbackSecret: optional('GATEWAY_CALLBACK_SECRET') ?? 'sbx_gateway_callback_secret_01',
  charityWebhookSecret:
    optional('CHARITY_WEBHOOK_SECRET') ?? 'whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz',
  charityWebhookUrl: optional('CHARITY_WEBHOOK_URL') ?? null,
} as const;

export const names = {
  holdKey: (boxNumber: number) => namespaced(`hold:${boxNumber}`),
  lookupKey: (client: string) => namespaced(`lookup:${client}`),
  exchange: namespaced('press.events'),
  fulfilmentQueue: namespaced('press.fulfilment'),
  retryQueue: namespaced('press.fulfilment.retry'),
  deadQueue: namespaced('press.fulfilment.dead'),
  publicIndex: namespaced('press_public'),
  staffIndex: namespaced('press_staff'),
  makerTopic: namespaced('svovlstik-maker'),
  svixApplication: namespaced('svovlstik-charity'),
} as const;
