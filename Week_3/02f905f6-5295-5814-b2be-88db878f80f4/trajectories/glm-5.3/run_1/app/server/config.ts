export interface AppConfig {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: {
    host: string;
    port: number;
    mailFrom: string;
  };
  appPublicUrl: string;
  firingHourSeconds: number;
  pickupDaySeconds: number;
  port: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      region: process.env.S3_REGION || "us-east-1",
      bucket: required("S3_BUCKET"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY")
    },
    killbill: {
      url: required("KILLBILL_URL").replace(/\/+$/, ""),
      username: required("KILLBILL_USERNAME"),
      password: required("KILLBILL_PASSWORD"),
      apiKey: required("KILLBILL_API_KEY"),
      apiSecret: required("KILLBILL_API_SECRET")
    },
    smtp: {
      host: required("SMTP_HOST"),
      port: num("SMTP_PORT", 1025),
      mailFrom: required("MAIL_FROM")
    },
    appPublicUrl: (process.env.APP_PUBLIC_URL || `http://127.0.0.1:${num("APP_PUBLIC_PORT", 4173)}`).replace(/\/+$/, ""),
    firingHourSeconds: num("FIRING_HOUR_SECONDS", 3600),
    pickupDaySeconds: num("PICKUP_DAY_SECONDS", 86400),
    port: num("APP_PUBLIC_PORT", 4173)
  };
}
