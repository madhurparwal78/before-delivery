// Environment configuration, read once at start. Nothing here is ever sent to the browser.
export interface Env {
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  mailFromAddress: string;
  publicPort: number;
  holdTtlSeconds: number;
  stepupCodeTtlSeconds: number;
  stepupLockSeconds: number;
  stepupRateLimit: number;
  stepupRateWindowSeconds: number;
  subscriptionLockHours: number;
  sessionSecret: string;
}

const DEFAULTS = {
  publicPort: 4173,
  holdTtlSeconds: 600,
  stepupCodeTtlSeconds: 300,
  stepupLockSeconds: 900,
  stepupRateLimit: 3,
  stepupRateWindowSeconds: 600,
  subscriptionLockHours: 48
} as const;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function strEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function readEnv(): Env {
  const mailFrom = strEnv("MAIL_FROM", "Pain de Lune <bonjour@paindelune.example>");
  const fromMatch = /<([^>]*)>\s*$/.exec(mailFrom);
  return {
    databaseUrl: strEnv("DATABASE_URL", "postgresql://localhost:5432/loafline"),
    killbillUrl: strEnv("KILLBILL_URL", "http://localhost:8080").replace(/\/+$/, ""),
    killbillUsername: strEnv("KILLBILL_USERNAME"),
    killbillPassword: strEnv("KILLBILL_PASSWORD"),
    killbillApiKey: strEnv("KILLBILL_API_KEY"),
    killbillApiSecret: strEnv("KILLBILL_API_SECRET"),
    smtpHost: strEnv("SMTP_HOST", "localhost"),
    smtpPort: intEnv("SMTP_PORT", 1025, 1, 65535),
    mailFrom,
    mailFromAddress: fromMatch?.[1] ?? mailFrom,
    publicPort: intEnv("APP_PUBLIC_PORT", DEFAULTS.publicPort, 1, 65535),
    holdTtlSeconds: intEnv("HOLD_TTL_SECONDS", DEFAULTS.holdTtlSeconds, 10, 3600),
    stepupCodeTtlSeconds: intEnv("STEPUP_CODE_TTL_SECONDS", DEFAULTS.stepupCodeTtlSeconds, 10, 100000),
    stepupLockSeconds: intEnv("STEPUP_LOCK_SECONDS", DEFAULTS.stepupLockSeconds, 1, 100000),
    stepupRateLimit: intEnv("STEPUP_RATE_LIMIT", DEFAULTS.stepupRateLimit, 1, 10000),
    stepupRateWindowSeconds: intEnv("STEPUP_RATE_WINDOW_SECONDS", DEFAULTS.stepupRateWindowSeconds, 1, 100000),
    subscriptionLockHours: intEnv("SUBSCRIPTION_LOCK_HOURS", DEFAULTS.subscriptionLockHours, 1, 1000),
    sessionSecret: strEnv("SESSION_SECRET") || cryptoRandomToken()
  };
}

import { randomBytes } from "node:crypto";
function cryptoRandomToken(): string {
  return randomBytes(32).toString("base64url");
}
