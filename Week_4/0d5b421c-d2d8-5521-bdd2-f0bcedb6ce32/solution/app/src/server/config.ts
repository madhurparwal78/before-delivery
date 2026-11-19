// The one place the environment is read. Nothing here is ever sent to the browser.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const port = integer("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: (process.env["APP_PUBLIC_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  valkeyUrl: required("VALKEY_URL"),
  keyPrefix: process.env["VALKEY_KEY_PREFIX"] ?? "",
  killBill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 1025) },
  mailFrom: process.env["MAIL_FROM"] ?? "Saffron & Slate <tables@saffronslate.example>",
  holdSeconds: integer("HOLD_SECONDS", 300),
  offerSeconds: integer("OFFER_SECONDS", 900),
  clockControl: process.env["APP_CLOCK_CONTROL"] === "1",
} as const;
