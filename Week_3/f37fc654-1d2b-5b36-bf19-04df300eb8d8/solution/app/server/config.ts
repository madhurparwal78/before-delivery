// The one place the environment is read. Every value comes from the variables the brief names;
// the only literals are the defaults the brief prints.

/** An environment value; an unset one reads as empty and the service using it reports itself down. */
function env(name: string): string {
  return process.env[name] ?? "";
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const port = seconds("APP_PUBLIC_PORT", 4173);
const quoteTtl = process.env.QUOTE_TTL_SECONDS;

export const config = {
  port,
  publicUrl: trimSlash(env("APP_PUBLIC_URL")),
  databaseUrl: env("DATABASE_URL"),
  keycloak: {
    url: trimSlash(env("KEYCLOAK_URL")),
    realm: env("KEYCLOAK_REALM"),
    issuer: trimSlash(env("AUTH_ISSUER_URL")),
    clientId: env("AUTH_CLIENT_ID"),
    clientSecret: env("AUTH_CLIENT_SECRET"),
  },
  killbill: {
    url: trimSlash(env("KILLBILL_URL")),
    username: env("KILLBILL_USERNAME"),
    password: env("KILLBILL_PASSWORD"),
    apiKey: env("KILLBILL_API_KEY"),
    apiSecret: env("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")),
    from: env("MAIL_FROM"),
  },
  s3: {
    endpoint: trimSlash(env("S3_ENDPOINT")),
    region: env("S3_REGION"),
    bucket: env("S3_BUCKET"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE") !== "false",
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  },
  gotenbergUrl: trimSlash(env("GOTENBERG_URL")),
  svix: { url: trimSlash(env("SVIX_URL")), apiKey: env("SVIX_API_KEY") },
  ntfy: { url: trimSlash(env("NTFY_URL")), username: env("NTFY_USERNAME"), password: env("NTFY_PASSWORD") },
  render: {
    url: trimSlash(env("WIREMOCK_URL")),
    webhookSecret: process.env.RENDER_WEBHOOK_SECRET || "spindrift-render-dev-secret",
  },
  timers: {
    holdSeconds: seconds("HOLD_SECONDS", 720),
    inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604800),
    quoteTtlSeconds: quoteTtl && /^\d+$/.test(quoteTtl) ? Number(quoteTtl) : null,
    accessTtlSeconds: seconds("ACCESS_TTL_SECONDS", 300),
  },
} as const;
