// Every service URL, credential and timing value, read from the environment once at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

export const config = {
  port: positiveInt("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  trialLengthSeconds: positiveInt("TRIAL_LENGTH_SECONDS", 1_209_600),
  trialNoticeLeadSeconds: positiveInt("TRIAL_NOTICE_LEAD_SECONDS", 259_200),
  billingCallbackToleranceSeconds: positiveInt("BILLING_CALLBACK_TOLERANCE_SECONDS", 300),
  idempotencyTtlSeconds: positiveInt("IDEMPOTENCY_TTL_SECONDS", 86_400),
  sessionTtlSeconds: positiveInt("SESSION_TTL_SECONDS", 2_592_000),
} as const;

/** Every Kill Bill or SMTP call counts as unreachable after this long. */
export const SERVICE_TIMEOUT_MS = 5_000;
