/** Configuration read from the environment at start; never hard-coded, never sent to the browser. */

export interface Config {
  port: number;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  holdTtlSeconds: number;
  reminderSweepSeconds: number;
}

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: int(env["APP_PUBLIC_PORT"], 4173),
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    killbillUrl: requireEnv(env, "KILLBILL_URL"),
    killbillUsername: requireEnv(env, "KILLBILL_USERNAME"),
    killbillPassword: requireEnv(env, "KILLBILL_PASSWORD"),
    killbillApiKey: requireEnv(env, "KILLBILL_API_KEY"),
    killbillApiSecret: requireEnv(env, "KILLBILL_API_SECRET"),
    s3Endpoint: requireEnv(env, "S3_ENDPOINT"),
    s3Region: env["S3_REGION"] ?? "us-east-1",
    s3Bucket: requireEnv(env, "S3_BUCKET"),
    s3ForcePathStyle: env["S3_FORCE_PATH_STYLE"] !== "false",
    s3AccessKeyId: requireEnv(env, "S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireEnv(env, "S3_SECRET_ACCESS_KEY"),
    smtpHost: requireEnv(env, "SMTP_HOST"),
    smtpPort: int(env["SMTP_PORT"], 1025),
    holdTtlSeconds: int(env["HOLD_TTL_SECONDS"], 600),
    reminderSweepSeconds: int(env["REMINDER_SWEEP_SECONDS"], 60)
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
