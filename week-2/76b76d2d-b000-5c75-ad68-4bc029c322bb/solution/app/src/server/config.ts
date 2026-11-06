/** The one place the environment is read. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be a whole number from 1 to ${max}`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || "4173");

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
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
    from: process.env.MAIL_FROM || "Halide Box Office <billetterie@halide.example>",
  },
  holdTtlSeconds: seconds("HOLD_TTL_SECONDS", 480, 3600),
  stepupCodeTtlSeconds: seconds("STEPUP_CODE_TTL_SECONDS", 600, 3600),
  stepupValidSeconds: seconds("STEPUP_VALID_SECONDS", 600, 3600),
  stepupLockoutSeconds: seconds("STEPUP_LOCKOUT_SECONDS", 900, 86400),
} as const;

/** Each running instance delivers only its own outbox messages (brief: Mail outbox). */
export const instanceId = String(port);
