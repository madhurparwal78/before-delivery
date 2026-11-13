/** Every credential and service URL, read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

const retrySeconds = Number(process.env.DEPENDENCY_RETRY_SECONDS ?? "5");
const port = Number(process.env.APP_PUBLIC_PORT ?? "4173");

export const config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  meilisearch: {
    url: required("MEILISEARCH_URL"),
    apiKey: required("MEILISEARCH_API_KEY"),
  },
  amqpUrl: required("AMQP_URL"),
  ephemerisUrl: required("WIREMOCK_URL"),
  gotenbergUrl: required("GOTENBERG_URL"),
  valkeyUrl: required("VALKEY_URL"),
  killbill: {
    url: required("KILLBILL_URL"),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  svix: { url: required("SVIX_URL"), apiKey: required("SVIX_API_KEY") },
  ntfy: {
    url: required("NTFY_URL"),
    username: required("NTFY_USERNAME"),
    password: required("NTFY_PASSWORD"),
  },
  port: Number.isFinite(port) ? port : 4173,
  publicUrl: optional("APP_PUBLIC_URL"),
  dependencyRetrySeconds: Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : 5,
} as const;

/** Every outbound call to a dependency gives up after this long unless stated otherwise. */
export const DEPENDENCY_TIMEOUT_MS = 3000;
