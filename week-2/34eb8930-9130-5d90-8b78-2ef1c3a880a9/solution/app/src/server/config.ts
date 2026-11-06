/** Every setting the app reads, read once at start (Configuration and secrets). */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function idleSeconds(): number {
  const raw = process.env.PRESENCE_IDLE_SECONDS;
  if (raw === undefined || raw === "") return 60;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3600) throw new Error("PRESENCE_IDLE_SECONDS must be a whole number from 1 to 3600");
  return n;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  idleMs: idleSeconds() * 1000,
} as const;
