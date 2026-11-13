function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  /** Mailpit's HTTP API base (brief: the server reads it at start); mail itself goes over SMTP. */
  readonly mailpitUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly openCallLeadMinutes: number;
  readonly prepAccessGraceMinutes: number;
  readonly prepLinkTtlSeconds: number;
}

function loadConfig(): Config {
  return {
    port: wholeNumber("APP_PUBLIC_PORT", 4173),
    databaseUrl: required("DATABASE_URL"),
    smtpHost: required("SMTP_HOST"),
    smtpPort: wholeNumber("SMTP_PORT", 1025),
    mailFrom: required("MAIL_FROM"),
    mailpitUrl: (process.env["MAILPIT_URL"] ?? "").replace(/\/+$/, ""),
    killbill: {
      url: required("KILLBILL_URL").replace(/\/+$/, ""),
      username: required("KILLBILL_USERNAME"),
      password: required("KILLBILL_PASSWORD"),
      apiKey: required("KILLBILL_API_KEY"),
      apiSecret: required("KILLBILL_API_SECRET"),
    },
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    openCallLeadMinutes: wholeNumber("OPEN_CALL_LEAD_MINUTES", 1440),
    prepAccessGraceMinutes: wholeNumber("PREP_ACCESS_GRACE_MINUTES", 4320),
    prepLinkTtlSeconds: wholeNumber("PREP_LINK_TTL_SECONDS", 300),
  };
}

export const config: Config = loadConfig();
