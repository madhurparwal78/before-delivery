/** Every environment variable the server reads, read once at start. */

function text(name: string): string {
  return process.env[name] ?? "";
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const port = Number(process.env.APP_PUBLIC_PORT) || 4173;

export const config = {
  port,
  databaseUrl: text("DATABASE_URL"),
  smtpHost: text("SMTP_HOST"),
  smtpPort: Number(process.env.SMTP_PORT) || 25,
  mailFrom: process.env.MAIL_FROM || "Duefield <reminders@duefield.test>",
  gotenbergUrl: text("GOTENBERG_URL").replace(/\/+$/, ""),
  gradingKey: text("GRADING_KEY"),
  retryMs: seconds("SERVICE_RETRY_SECONDS", 30) * 1000,
  sessionTtlSeconds: seconds("SESSION_TTL_SECONDS", 604800),
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
} as const;
