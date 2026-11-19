import { UFERN_PER_FERN } from "../shared/units.ts";

/** The only reader of the environment: every service credential, URL, timer and limit comes through here. */

function text(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  return value ?? "";
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative whole number`);
  return value;
}

/** A decimal string such as "0.1" as an exact fraction, so the fee rule never touches floating point. */
function decimalFraction(name: string, fallback: string): { numerator: bigint; denominator: bigint } {
  const raw = text(name, fallback);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`${name} must be a decimal number`);
  const places = (match[2] ?? "").length;
  return { numerator: BigInt(`${match[1]}${match[2] ?? ""}`), denominator: 10n ** BigInt(places) };
}

const clockMode = text("CLOCK_MODE", "realtime");
if (clockMode !== "realtime" && clockMode !== "manual") throw new Error("CLOCK_MODE must be realtime or manual");

const startAt = new Date(text("APP_START_AT", "2026-11-06T09:00:00Z"));
if (Number.isNaN(startAt.getTime())) throw new Error("APP_START_AT must be an ISO time");

export const config = {
  databaseUrl: text("DATABASE_URL"),
  storage: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: text("SMTP_HOST"),
    port: whole("SMTP_PORT", 1025),
    from: text("MAIL_FROM", "Fernsquare <no-reply@fernsquare.test>"),
  },
  publicUrl: text("APP_PUBLIC_URL").replace(/\/+$/, ""),
  port: whole("APP_PUBLIC_PORT", 4173),
  gradingKey: text("GRADING_KEY"),
  clockMode,
  startAt,
  timeZone: text("APP_TIME_ZONE", "Europe/Berlin"),
  blockTimeMs: whole("BLOCK_TIME_SECONDS", 15) * 1000,
  maxSquareWidth: whole("MAX_SQUARE_WIDTH", 8),
  minGasPrice: decimalFraction("MIN_GAS_PRICE", "0.1"),
  blockRewardUfern: whole("BLOCK_REWARD_UFERN", UFERN_PER_FERN),
  sampleSeed: whole("SAMPLE_SEED", 42),
  samplesPerBlock: whole("SAMPLES_PER_BLOCK", 16),
  sampleIntervalMs: whole("SAMPLE_INTERVAL_MS", 1000),
  fraudCheckDelayMs: whole("FRAUD_CHECK_DELAY_MS", 5000),
  unbondingMs: whole("UNBONDING_SECONDS", 120) * 1000,
  maxUnbondings: whole("MAX_UNBONDINGS", 7),
  maxRedelegations: whole("MAX_REDELEGATIONS", 7),
  minDepositUfern: whole("MIN_DEPOSIT_FERN", 100) * UFERN_PER_FERN,
  depositPeriodMs: whole("DEPOSIT_PERIOD_SECONDS", 300) * 1000,
  votingPeriodMs: whole("VOTING_PERIOD_SECONDS", 600) * 1000,
  voteReminderMs: whole("VOTE_REMINDER_SECONDS", 120) * 1000,
  inviteTtlMs: whole("INVITE_TTL_HOURS", 72) * 3_600_000,
  squareRowRevealMs: whole("SQUARE_ROW_REVEAL_MS", 100),
} as const;
