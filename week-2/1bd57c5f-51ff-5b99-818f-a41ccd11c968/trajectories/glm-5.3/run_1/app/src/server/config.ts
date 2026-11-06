export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

const port = (() => {
  const p = process.env.APP_PUBLIC_PORT;
  if (p !== undefined && p !== "") {
    const n = Number(p);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return 4173;
})();

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 0) || 0,
  },
  mailFrom: process.env.MAIL_FROM ?? "Snaglight <notices@snaglight.example>",
  publicUrl: (process.env.APP_PUBLIC_URL && process.env.APP_PUBLIC_URL !== "" ? process.env.APP_PUBLIC_URL : `http://localhost:${port}`).replace(/\/+$/, ""),
  port,
  sessionIdleMinutes: (() => {
    const raw = process.env.SESSION_IDLE_MINUTES;
    const n = raw === undefined || raw === "" ? 720 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 720;
  })(),
  summaryLocalTime: (() => {
    const raw = process.env.SUMMARY_LOCAL_TIME;
    if (raw !== undefined && /^\d{2}:\d{2}$/.test(raw)) return raw;
    return "18:00";
  })(),
  summaryQuietSeconds: (() => {
    const raw = process.env.SUMMARY_QUIET_SECONDS;
    if (raw === undefined || raw === "") return 60;
    const n = Math.trunc(Number(raw));
    if (Number.isInteger(n) && n >= 0 && n <= 60) return n;
    return 60;
  })(),
  eventRetentionCount: (() => {
    const raw = process.env.EVENT_RETENTION_COUNT;
    if (raw === undefined || raw === "") return 1000;
    const n = Math.trunc(Number(raw));
    if (Number.isInteger(n) && n >= 10 && n <= 100000) return n;
    return 1000;
  })(),
};
