import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface Config {
  port: number;
  databaseUrl: string;
  appSecret: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number; from: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  holdSeconds: number;
  waitlistClaimSeconds: number;
  proofDecisionSeconds: number;
  billingDaySeconds: number;
  signedReadSeconds: number;
  mailFrom: string;
}

const rawConfig = {
  port: intFromEnv("APP_PUBLIC_PORT", 4173),
  databaseUrl: process.env.DATABASE_URL ?? "",
  killbill: {
    url: (process.env.KILLBILL_URL ?? "").replace(/\/$/, ""),
    username: process.env.KILLBILL_USERNAME ?? "",
    password: process.env.KILLBILL_PASSWORD ?? "",
    apiKey: process.env.KILLBILL_API_KEY ?? "",
    apiSecret: process.env.KILLBILL_API_SECRET ?? "",
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: intFromEnv("SMTP_PORT", 1025),
    from: process.env.MAIL_FROM ?? "Kerf Frequencies <tickets@kerf.example>",
  },
  s3: {
    endpoint: (process.env.S3_ENDPOINT ?? "").replace(/\/$/, ""),
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  holdSeconds: intFromEnv("HOLD_SECONDS", 600),
  waitlistClaimSeconds: intFromEnv("WAITLIST_CLAIM_SECONDS", 7200),
  proofDecisionSeconds: intFromEnv("PROOF_DECISION_SECONDS", 259200),
  billingDaySeconds: intFromEnv("BILLING_DAY_SECONDS", 86400),
  signedReadSeconds: intFromEnv("SIGNED_READ_SECONDS", 60),
};

// APP_SECRET signs cookies and file links. When unset, a random secret is stored in
// Postgres once so instances sharing the database agree.
export async function resolveSecret(query: (sql: string, args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>): Promise<string> {
  const envSecret = process.env.APP_SECRET;
  if (envSecret && envSecret.length > 0) return envSecret;
  const existing = await query("select secret from app_secret where id = 1", []);
  if (existing.rows.length > 0 && typeof existing.rows[0].secret === "string") {
    return existing.rows[0].secret as string;
  }
  const secret = randomBytes(32).toString("hex");
  await query("insert into app_secret (id, secret) values (1, $1) on conflict (id) do nothing", [secret]);
  const after = await query("select secret from app_secret where id = 1", []);
  return String(after.rows[0]?.secret ?? secret);
}

export function configWithSecret(secret: string): Config {
  return { ...rawConfig, appSecret: secret, mailFrom: rawConfig.smtp.from };
}

export function hashPassword(password: string, salt?: string): string {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, useSalt, 32).toString("hex");
  return `${useSalt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
