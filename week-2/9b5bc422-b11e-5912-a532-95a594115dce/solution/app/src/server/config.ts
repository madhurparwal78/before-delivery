function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export const config = {
  port: Number(process.env["APP_PUBLIC_PORT"] ?? 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  shareLinkSeconds: Number(process.env["SHARE_LINK_SECONDS"] ?? 604800),
  accountStorageBytes: Number(process.env["ACCOUNT_STORAGE_BYTES"] ?? 50_000_000),
};
