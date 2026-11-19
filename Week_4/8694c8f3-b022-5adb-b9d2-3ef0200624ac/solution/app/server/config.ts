function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

interface Config {
  port: number;
  databaseUrl: string;
  storage: StorageConfig;
  valkeyUrl: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env["APP_PUBLIC_PORT"] ?? 4173),
    databaseUrl: required("DATABASE_URL"),
    storage: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    valkeyUrl: required("VALKEY_URL"),
  };
}
