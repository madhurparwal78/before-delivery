export type AppConfig = {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
};

export function loadConfig(): AppConfig {
  const port = process.env["APP_PUBLIC_PORT"] ? Number(process.env["APP_PUBLIC_PORT"]) : 4173;
  const publicUrl = process.env["APP_PUBLIC_URL"] || `http://localhost:${port}`;
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const smtpHost = process.env["SMTP_HOST"];
  const smtpPort = Number(process.env["SMTP_PORT"]);
  if (!smtpHost || !smtpPort || Number.isNaN(smtpPort)) throw new Error("SMTP_HOST and SMTP_PORT are required");
  return { port, publicUrl, databaseUrl, smtpHost, smtpPort };
}
