// Every service URL and credential comes from the environment, read once at start (brief: Configuration).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || "4173"),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    adminEmail: required("POCKETBASE_ADMIN_EMAIL"),
    adminPassword: required("POCKETBASE_ADMIN_PASSWORD"),
  },
} as const;
