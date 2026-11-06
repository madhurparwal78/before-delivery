// The only reader of process.env: every service URL and credential comes from its environment variable.
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: required("MAIL_FROM") },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  port: Number(process.env.APP_PUBLIC_PORT ?? "4173"),
  clockControl: process.env.CLOCK_CONTROL === "enabled",
} as const;
