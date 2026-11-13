function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function fixedClock(): Date | null {
  const value = process.env.STOWDECK_NOW;
  return value ? new Date(value) : null;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  meilisearch: {
    url: required("MEILISEARCH_URL"),
    apiKey: required("MEILISEARCH_API_KEY"),
    index: process.env.MEILISEARCH_INDEX ?? "references",
  },
  gotenbergUrl: required("GOTENBERG_URL"),
  trashRetentionSeconds: Number(process.env.STOWDECK_TRASH_RETENTION_SECONDS ?? 2_592_000),
  fixedNow: fixedClock(),
} as const;
