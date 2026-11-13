function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the environment`);
  return value;
}

export const config = {
  listenHost: "0.0.0.0",
  port: Number(process.env["APP_PUBLIC_PORT"] ?? 4173),
  roomIdleSeconds: Number(process.env["ROOM_IDLE_SECONDS"] ?? 1800),
  imageUrlTtlSeconds: Number(process.env["IMAGE_URL_TTL_SECONDS"] ?? 120),
  databaseUrl: required("DATABASE_URL"),
  valkeyUrl: required("VALKEY_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
} as const;
