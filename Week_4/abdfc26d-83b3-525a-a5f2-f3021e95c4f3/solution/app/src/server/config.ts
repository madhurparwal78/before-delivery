// The one place the environment is read, once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

const trim = (url: string): string => url.replace(/\/+$/, "");
const mailFrom = required("MAIL_FROM");

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: trim(required("APP_PUBLIC_URL")),
  databaseUrl: required("DATABASE_URL"),
  keycloak: {
    url: trim(required("KEYCLOAK_URL")),
    realm: required("KEYCLOAK_REALM"),
    issuer: trim(required("AUTH_ISSUER_URL")),
    clientId: required("AUTH_CLIENT_ID"),
    clientSecret: required("AUTH_CLIENT_SECRET"),
  },
  killbill: {
    url: trim(required("KILLBILL_URL")),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  s3: {
    endpoint: trim(required("S3_ENDPOINT")),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  amqpUrl: required("AMQP_URL"),
  renderQueue: process.env.RENDER_QUEUE || "render.jobs",
  providerUrl: trim(required("WIREMOCK_URL")),
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: mailFrom,
    envelopeFrom: (/<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom).trim(),
  },
  gotenbergUrl: trim(required("GOTENBERG_URL")),
  holdSeconds: seconds("HOLD_SECONDS", 600),
  providerTimeoutSeconds: seconds("PROVIDER_TIMEOUT_SECONDS", 120),
  renderBackoffSeconds: seconds("RENDER_BACKOFF_SECONDS", 5),
  refundWindowSeconds: seconds("REFUND_WINDOW_SECONDS", 2_592_000),
  idempotencyTtlSeconds: seconds("IDEMPOTENCY_TTL_SECONDS", 86_400),
  presignSeconds: seconds("PRESIGN_SECONDS", 300),
} as const;
