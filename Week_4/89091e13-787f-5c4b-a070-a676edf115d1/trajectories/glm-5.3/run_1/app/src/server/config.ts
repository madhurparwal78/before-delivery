// Server configuration read once at start from the environment.

export interface AppConfig {
  port: number;
  publicUrl: string;
  gradingKey: string;
  clockMode: "realtime" | "manual";
  appStartAtMs: number;
  appTimeZone: string;
  blockTimeSeconds: number;
  maxSquareWidth: number;
  minGasPriceUfernPerGas: number;
  blockRewardUfern: bigint;
  sampleSeed: number;
  samplesPerBlock: number;
  sampleIntervalMs: number;
  fraudCheckDelayMs: number;
  unbondingSeconds: number;
  maxUnbondings: number;
  maxRedelegations: number;
  minDepositUfern: bigint;
  depositPeriodSeconds: number;
  votingPeriodSeconds: number;
  voteReminderSeconds: number;
  inviteTtlHours: number;
  squareRowRevealMs: number;
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBigint(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export function loadConfig(): AppConfig {
  const startAtRaw = envString("APP_START_AT", "2026-11-06T09:00:00Z");
  const startAtMs = Date.parse(startAtRaw);
  const clockModeRaw = envString("CLOCK_MODE", "realtime");
  return {
    port: envNumber("APP_PUBLIC_PORT", 4173),
    publicUrl: envString("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
    gradingKey: envString("GRADING_KEY", "fernsquare-grading"),
    clockMode: clockModeRaw === "manual" ? "manual" : "realtime",
    appStartAtMs: Number.isFinite(startAtMs) ? startAtMs : Date.parse("2026-11-06T09:00:00Z"),
    appTimeZone: envString("APP_TIME_ZONE", "Europe/Berlin"),
    blockTimeSeconds: envNumber("BLOCK_TIME_SECONDS", 15),
    maxSquareWidth: envNumber("MAX_SQUARE_WIDTH", 8),
    minGasPriceUfernPerGas: envNumber("MIN_GAS_PRICE", 0.1),
    blockRewardUfern: envBigint("BLOCK_REWARD_UFERN", 1_000_000n),
    sampleSeed: envNumber("SAMPLE_SEED", 42),
    samplesPerBlock: envNumber("SAMPLES_PER_BLOCK", 16),
    sampleIntervalMs: envNumber("SAMPLE_INTERVAL_MS", 1000),
    fraudCheckDelayMs: envNumber("FRAUD_CHECK_DELAY_MS", 5000),
    unbondingSeconds: envNumber("UNBONDING_SECONDS", 120),
    maxUnbondings: envNumber("MAX_UNBONDINGS", 7),
    maxRedelegations: envNumber("MAX_REDELEGATIONS", 7),
    minDepositUfern: envBigint("MIN_DEPOSIT_FERN", 100n) * 1_000_000n,
    depositPeriodSeconds: envNumber("DEPOSIT_PERIOD_SECONDS", 300),
    votingPeriodSeconds: envNumber("VOTING_PERIOD_SECONDS", 600),
    voteReminderSeconds: envNumber("VOTE_REMINDER_SECONDS", 120),
    inviteTtlHours: envNumber("INVITE_TTL_HOURS", 72),
    squareRowRevealMs: envNumber("SQUARE_ROW_REVEAL_MS", 100),
    databaseUrl: envString("DATABASE_URL", "postgresql://localhost:5432/fernsquare"),
    smtpHost: envString("SMTP_HOST", "mailpit"),
    smtpPort: envNumber("SMTP_PORT", 1025),
    mailFrom: envString("MAIL_FROM", "Fernsquare <no-reply@fernsquare.test>"),
    storage: {
      endpoint: envString("S3_ENDPOINT", "http://127.0.0.1:9000"),
      region: envString("S3_REGION", "us-east-1"),
      bucket: envString("S3_BUCKET", "fernsquare"),
      forcePathStyle: envString("S3_FORCE_PATH_STYLE", "true") === "true",
      accessKeyId: envString("S3_ACCESS_KEY_ID", ""),
      secretAccessKey: envString("S3_SECRET_ACCESS_KEY", ""),
    },
  };
}
