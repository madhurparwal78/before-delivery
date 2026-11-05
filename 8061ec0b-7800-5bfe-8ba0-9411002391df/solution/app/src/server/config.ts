// The one place the environment is read. Every service URL and credential comes from here, read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

function wholeSeconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be whole seconds`);
  return Number(value);
}

function instant(name: string): Date | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be an ISO 8601 instant`);
  return parsed;
}

const port = Number(process.env.APP_PUBLIC_PORT || "4173");

export const config = {
  port,
  publicOrigin: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL"),
  killBill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: required("MAIL_FROM") },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  holdSeconds: wholeSeconds("RESERVATION_HOLD_SECONDS", 172_800),
  signingLinkSeconds: wholeSeconds("SIGNING_LINK_TTL_SECONDS", 86_400),
  clockStart: instant("BELLROLL_CLOCK_START"),
};
