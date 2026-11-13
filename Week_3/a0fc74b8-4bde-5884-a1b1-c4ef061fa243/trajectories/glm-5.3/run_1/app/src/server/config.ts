export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  mailFrom: { name: string; address: string };
  gradingKey: string | null;
  linkTtlSeconds: number;
  reminderCooldownSeconds: number;
  mailRetrySeconds: number;
  sealRetrySeconds: number;
}

function parseMailFrom(raw: string): { name: string; address: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1], address: m[2] };
  return { name: "", address: raw.trim() };
}

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function strEnv(name: string, def: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw !== "" ? raw : def;
}

export function loadConfig(): AppConfig {
  const publicUrl = strEnv("APP_PUBLIC_URL", "http://127.0.0.1:4173").replace(/\/+$/, "");
  const mailFromRaw = strEnv("MAIL_FROM", "Undersign <sign@wickmoor.example>");
  return {
    port: intEnv("APP_PUBLIC_PORT", 4173),
    publicUrl,
    databaseUrl: strEnv("DATABASE_URL", "postgresql://localhost:5432/undersign"),
    s3: {
      endpoint: strEnv("S3_ENDPOINT", "http://127.0.0.1:9000"),
      region: strEnv("S3_REGION", "us-east-1"),
      bucket: strEnv("S3_BUCKET", "undersign"),
      forcePathStyle: strEnv("S3_FORCE_PATH_STYLE", "true") !== "false",
      accessKeyId: strEnv("S3_ACCESS_KEY_ID", ""),
      secretAccessKey: strEnv("S3_SECRET_ACCESS_KEY", ""),
    },
    smtp: { host: strEnv("SMTP_HOST", "127.0.0.1"), port: intEnv("SMTP_PORT", 1025) },
    mailFrom: parseMailFrom(mailFromRaw),
    gradingKey: process.env.GRADING_KEY && process.env.GRADING_KEY !== "" ? process.env.GRADING_KEY : null,
    linkTtlSeconds: intEnv("LINK_TTL_SECONDS", 1209600),
    reminderCooldownSeconds: intEnv("REMINDER_COOLDOWN_SECONDS", 86400),
    mailRetrySeconds: intEnv("MAIL_RETRY_SECONDS", 30),
    sealRetrySeconds: intEnv("SEAL_RETRY_SECONDS", 30),
  };
}
