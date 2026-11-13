// The only module that reads the environment.
const env = process.env;

interface Cidr { base: number; bits: number }

function parseCidrs(list: string | undefined): Cidr[] {
  const out: Cidr[] = [];
  for (const part of (list ?? "").split(",")) {
    const m = /^\s*(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)\s*$/.exec(part);
    if (!m) continue;
    const octets = [m[1], m[2], m[3], m[4]].map(Number);
    const bits = Number(m[5]);
    if (octets.some((o) => o > 255) || bits > 32) continue;
    const base = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
    out.push({ base, bits });
  }
  return out;
}

const s3Endpoint = (env.S3_ENDPOINT ?? "").replace(/\/+$/, "");

export const config = {
  port: Number(env.APP_PUBLIC_PORT) || 4173,
  databaseUrl: env.DATABASE_URL ?? "",
  svixUrl: (env.SVIX_URL ?? "").replace(/\/+$/, ""),
  svixApiKey: env.SVIX_API_KEY ?? "",
  gotenbergUrl: (env.GOTENBERG_URL ?? "").replace(/\/+$/, ""),
  amqpUrl: env.AMQP_URL ?? "",
  amqpConnectAddress: env.AMQP_CONNECT_ADDRESS ?? "",
  meiliUrl: (env.MEILISEARCH_URL ?? "").replace(/\/+$/, ""),
  meiliKey: env.MEILISEARCH_API_KEY ?? "",
  s3Endpoint,
  s3Region: env.S3_REGION ?? "us-east-1",
  s3Bucket: env.S3_BUCKET ?? "",
  s3AccessKeyId: env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  minioPublicUrl: (env.MINIO_PUBLIC_URL || s3Endpoint).replace(/\/+$/, ""),
  testClock: env.INTERVAL_TEST_CLOCK === "on",
  allowedCidrs: parseCidrs(env.STOCKIST_ENDPOINT_ALLOWED_CIDRS),
} as const;
