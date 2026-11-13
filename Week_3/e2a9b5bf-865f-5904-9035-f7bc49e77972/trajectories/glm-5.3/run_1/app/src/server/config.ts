// Configuration read at start from the environment (DP-60).
export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly gotenbergUrl: string;
  readonly smtp: { readonly host: string; readonly port: number };
  readonly mailFrom: string;
  readonly signinLockSeconds: number;
  readonly signinSessionSeconds: number;
}

export function readConfig(): AppConfig {
  const port = Number(process.env["APP_PUBLIC_PORT"] ?? 4173);
  return {
    port,
    databaseUrl: requireEnv("DATABASE_URL"),
    s3: {
      endpoint: requireEnv("S3_ENDPOINT"),
      region: process.env["S3_REGION"] ?? "us-east-1",
      bucket: requireEnv("S3_BUCKET"),
      forcePathStyle: (process.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    gotenbergUrl: requireEnv("GOTENBERG_URL"),
    smtp: {
      host: requireEnv("SMTP_HOST"),
      port: Number(requireEnv("SMTP_PORT")),
    },
    mailFrom: process.env["MAIL_FROM"] ?? "Lowlamp Field Log <packets@lowlamp.test>",
    signinLockSeconds: wholeSeconds("SIGNIN_LOCK_SECONDS", 900),
    signinSessionSeconds: wholeSeconds("SIGNIN_SESSION_SECONDS", 2_592_000),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
