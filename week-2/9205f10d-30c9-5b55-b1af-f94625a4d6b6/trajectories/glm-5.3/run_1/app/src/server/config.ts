export type Config = {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  sessionSecret: string;
};

export function loadConfig(): Config {
  const port = Number(process.env["APP_PUBLIC_PORT"] ?? 4173);
  const publicUrl = process.env["APP_PUBLIC_URL"] ?? `http://localhost:${port}`;
  const s3Endpoint = requireEnv("S3_ENDPOINT");
  return {
    port,
    publicUrl,
    databaseUrl: requireEnv("DATABASE_URL"),
    killbill: {
      url: requireEnv("KILLBILL_URL"),
      username: requireEnv("KILLBILL_USERNAME"),
      password: requireEnv("KILLBILL_PASSWORD"),
      apiKey: requireEnv("KILLBILL_API_KEY"),
      apiSecret: requireEnv("KILLBILL_API_SECRET"),
    },
    smtp: {
      host: requireEnv("SMTP_HOST"),
      port: Number(requireEnv("SMTP_PORT")),
      from: requireEnv("MAIL_FROM"),
    },
    s3: {
      endpoint: s3Endpoint,
      region: process.env["S3_REGION"] ?? "us-east-1",
      bucket: requireEnv("S3_BUCKET"),
      forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    sessionSecret: process.env["SESSION_SECRET"] ?? "crosshand-dev-secret",
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
