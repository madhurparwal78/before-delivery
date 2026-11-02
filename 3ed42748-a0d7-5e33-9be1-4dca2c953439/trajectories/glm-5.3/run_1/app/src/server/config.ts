import { randomBytes } from "node:crypto";

export interface AppConfig {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number; from: string };
  publicPort: number;
  publicUrl: string | null;
  postboxKeyTtlSeconds: number;
  rushHoldSeconds: number;
  postcardMailWindowSeconds: number;
}

function intEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(Math.floor(n), min);
}

export function loadConfig(): AppConfig {
  const portRaw = process.env.APP_PUBLIC_PORT;
  const publicPort = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : 4173;
  const publicUrl = process.env.APP_PUBLIC_URL?.trim() || null;
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT) || 25,
      from: process.env.MAIL_FROM ?? "",
    },
    publicPort,
    publicUrl,
    postboxKeyTtlSeconds: intEnv("POSTBOX_KEY_TTL_SECONDS", 900, 5),
    rushHoldSeconds: intEnv("RUSH_HOLD_SECONDS", 600, 4),
    postcardMailWindowSeconds: intEnv("POSTCARD_MAIL_WINDOW_SECONDS", 600, 20),
  };
}

/** `<base>`: APP_PUBLIC_URL without a trailing slash, or http://localhost:<port> when unset. */
export function baseUrl(cfg: AppConfig): string {
  if (cfg.publicUrl) {
    return cfg.publicUrl.endsWith("/") ? cfg.publicUrl.slice(0, -1) : cfg.publicUrl;
  }
  return `http://localhost:${cfg.publicPort}`;
}

/** Random ids: `acc_`/`pc_` + 24 lowercase hex characters (96 bits), only letters or digits. */
export function randomId(prefix: string): string {
  return prefix + randomBytes(12).toString("hex");
}

/** 32-char hex share token (128 bits), unrelated to any id. */
export function randomShareToken(): string {
  return randomBytes(16).toString("hex");
}

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randomToken(len = 32, alphabet = TOKEN_ALPHABET): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Session cookie value. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
