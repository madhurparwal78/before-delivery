// Every service address, credential and timing, read from the environment once at start.

export interface Config {
  readonly port: number;
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string; readonly helloName: string };
  readonly gradingRoutes: boolean;
  readonly verifyDelayMs: number;
  readonly signinLinkTtlSeconds: number;
  readonly rejoinSeconds: number;
  readonly finishGraceSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : Number.parseInt(value, 10);
}

export function readConfig(): Config {
  const port = integer("APP_PUBLIC_PORT", 4173);
  const publicUrl = (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    port,
    publicUrl,
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: required("SMTP_HOST"), port: Number.parseInt(required("SMTP_PORT"), 10), from: required("MAIL_FROM"), helloName: new URL(publicUrl).hostname },
    gradingRoutes: process.env.GRADING_ROUTES === "on",
    verifyDelayMs: integer("VERIFY_DELAY_MS", 0),
    signinLinkTtlSeconds: integer("SIGNIN_LINK_TTL_SECONDS", 900),
    rejoinSeconds: integer("REJOIN_SECONDS", 30),
    finishGraceSeconds: integer("FINISH_GRACE_SECONDS", 60),
  };
}
