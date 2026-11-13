/** Every service URL, credential and desk setting, read once from the environment at start. */

const env = process.env;

function text(name: string, fallback = ""): string {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** A whole-number setting where 0 is a real value, never replaced by the default. */
function whole(name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalWhole(name: string): number | null {
  const value = env[name];
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function frozenClock(): Date | null {
  const value = env["DESK_CLOCK_FROZEN_AT"];
  if (value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  appPublicUrl: text("APP_PUBLIC_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true").toLowerCase() === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  killBill: {
    url: text("KILLBILL_URL").replace(/\/+$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET"),
  },
  mail: {
    smtpHost: text("SMTP_HOST"),
    smtpPort: whole("SMTP_PORT", 1025),
    mailpitUrl: text("MAILPIT_URL").replace(/\/+$/, ""),
    from: text("MAIL_FROM", "Holmgarth Aftercare <desk@holmgarth.example>"),
  },
  carrierUrl: text("WIREMOCK_URL").replace(/\/+$/, ""),
  desk: {
    standardMonths: whole("AFTERCARE_STANDARD_MONTHS", 24),
    clubMonths: whole("AFTERCARE_CLUB_MONTHS", 36),
    termSecondsOverride: optionalWhole("AFTERCARE_TERM_SECONDS_OVERRIDE"),
    confirmLinkTtlSeconds: whole("CONFIRM_LINK_TTL_SECONDS", 1800),
    dispatchCutoffLocal: text("DISPATCH_CUTOFF_LOCAL", "14:00"),
    referenceLockSeconds: whole("REFERENCE_LOCK_SECONDS", 900),
    partsRatePerMinute: whole("PARTS_RATE_LIMIT_PER_MINUTE", 60),
    operatorSessionSeconds: whole("OPERATOR_SESSION_SECONDS", 43200),
    clockFrozenAt: frozenClock(),
  },
} as const;
