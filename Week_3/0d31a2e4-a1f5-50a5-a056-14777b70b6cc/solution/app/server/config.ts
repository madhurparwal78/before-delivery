// Configuration is read once at start, from the environment only.

interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  port: number;
  publicUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} must be set`);
  return value;
}

export function loadConfig(): Config {
  const port = Number(process.env["APP_PUBLIC_PORT"] ?? "4173");
  const publicUrl = (process.env["APP_PUBLIC_URL"] ?? "").trim();
  return {
    databaseUrl: required("DATABASE_URL"),
    smtpHost: required("SMTP_HOST"),
    smtpPort: Number(required("SMTP_PORT")),
    port,
    publicUrl: (publicUrl === "" ? `http://localhost:${port}` : publicUrl).replace(/\/+$/, ""),
  };
}
