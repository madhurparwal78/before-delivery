/** The one place the process environment is read. */

function seconds(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
  databaseUrl: process.env.DATABASE_URL ?? "",
  appNow: (process.env.APP_NOW ?? "").trim(),
  lockoutWindowSeconds: seconds("LOGIN_LOCKOUT_WINDOW_SECONDS", 900),
  inquiryRateWindowSeconds: seconds("INQUIRY_RATE_WINDOW_SECONDS", 600),
  fxQuoteTtlSeconds: seconds("FX_QUOTE_TTL_SECONDS", 600),
} as const;
