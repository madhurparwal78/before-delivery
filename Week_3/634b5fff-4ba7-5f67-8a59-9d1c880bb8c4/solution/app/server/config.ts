const env = process.env;

const text = (name: string, fallback = ""): string => env[name] ?? fallback;

const positive = (name: string, fallback: number): number => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const optionalPositive = (name: string): number | null => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const namespace = text("PRESS_NAMESPACE");
const port = positive("APP_PUBLIC_PORT", 4173);
const clockStart = text("PRESS_CLOCK_START");

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL").replace(/\/$/, ""),
  databaseUrl: text("DATABASE_URL"),
  killbill: {
    url: text("KILLBILL_URL").replace(/\/$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET"),
  },
  wiremockUrl: text("WIREMOCK_URL").replace(/\/$/, ""),
  keycloak: {
    url: text("KEYCLOAK_URL").replace(/\/$/, ""),
    realm: text("KEYCLOAK_REALM"),
    issuer: text("AUTH_ISSUER_URL").replace(/\/$/, ""),
    clientId: text("AUTH_CLIENT_ID"),
    clientSecret: text("AUTH_CLIENT_SECRET"),
  },
  valkeyUrl: text("VALKEY_URL"),
  amqpUrl: text("AMQP_URL"),
  meili: { url: text("MEILISEARCH_URL").replace(/\/$/, ""), apiKey: text("MEILISEARCH_API_KEY") },
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  gotenbergUrl: text("GOTENBERG_URL").replace(/\/$/, ""),
  smtp: { host: text("SMTP_HOST"), port: Number(text("SMTP_PORT")), from: text("MAIL_FROM") },
  svix: { url: text("SVIX_URL").replace(/\/$/, ""), apiKey: text("SVIX_API_KEY") },
  ntfy: { url: text("NTFY_URL").replace(/\/$/, ""), username: text("NTFY_USERNAME"), password: text("NTFY_PASSWORD") },
  holdSeconds: positive("HOLD_SECONDS", 600),
  authSeconds: positive("AUTH_SECONDS", 604800),
  challengeSeconds: positive("CHALLENGE_SECONDS", 300),
  transferSeconds: optionalPositive("TRANSFER_SECONDS"),
  lookupWindowSeconds: positive("LOOKUP_WINDOW_SECONDS", 900),
  lowStockThresholds: text("LOW_STOCK_THRESHOLDS", "24,5")
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0),
  clockStart: clockStart ? Date.parse(clockStart) : null,
  gatewayCallbackSecret: text("GATEWAY_CALLBACK_SECRET", "sbx_gateway_callback_secret_01"),
  charityWebhookSecret: text("CHARITY_WEBHOOK_SECRET", "whsec_U3ZvdmxzdGlrQ2hhcml0eVNhbmRib3hLZXkwMTIz"),
  charityWebhookUrl: text("CHARITY_WEBHOOK_URL"),
  staffSeeds: [
    { username: "maker", password: "Maker-Press-2026!", role: "maker" },
    { username: "packer", password: "Packer-Press-2026!", role: "packer" },
    { username: "treasurer", password: "Treasurer-Press-2026!", role: "treasurer" },
  ],
} as const;

/** Applies the PRESS_NAMESPACE prefix to a Valkey key, queue, index, topic or Svix application name. */
export const named = (name: string): string => (namespace ? `${namespace}-${name}` : name);
