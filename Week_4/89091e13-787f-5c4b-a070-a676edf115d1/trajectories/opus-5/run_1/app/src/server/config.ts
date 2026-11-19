import { DecimalRate, parseRate } from '../shared/fees.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
}

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  appPublicUrl: string;
  port: number;
  gradingKey: string;
  clockMode: 'realtime' | 'manual';
  appStartAt: string;
  timeZone: string;
  blockTimeSeconds: number;
  maxSquareWidth: number;
  minGasPrice: DecimalRate;
  blockRewardUfern: bigint;
  sampleSeed: number;
  samplesPerBlock: number;
  sampleIntervalMs: number;
  fraudCheckDelayMs: number;
  unbondingSeconds: number;
  maxUnbondings: number;
  maxRedelegations: number;
  minDepositFern: number;
  depositPeriodSeconds: number;
  votingPeriodSeconds: number;
  voteReminderSeconds: number;
  inviteTtlHours: number;
  squareRowRevealMs: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: number('SMTP_PORT', 1025),
    from: optional('MAIL_FROM', 'Fernsquare <no-reply@fernsquare.test>'),
  },
  appPublicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  port: number('APP_PUBLIC_PORT', 4173),
  gradingKey: required('GRADING_KEY'),
  clockMode: optional('CLOCK_MODE', 'realtime') === 'manual' ? 'manual' : 'realtime',
  appStartAt: new Date(optional('APP_START_AT', '2026-11-06T09:00:00Z')).toISOString(),
  timeZone: optional('APP_TIME_ZONE', 'Europe/Berlin'),
  blockTimeSeconds: number('BLOCK_TIME_SECONDS', 15),
  maxSquareWidth: number('MAX_SQUARE_WIDTH', 8),
  minGasPrice: parseRate(optional('MIN_GAS_PRICE', '0.1')),
  blockRewardUfern: BigInt(optional('BLOCK_REWARD_UFERN', '1000000')),
  sampleSeed: number('SAMPLE_SEED', 42),
  samplesPerBlock: number('SAMPLES_PER_BLOCK', 16),
  sampleIntervalMs: number('SAMPLE_INTERVAL_MS', 1000),
  fraudCheckDelayMs: number('FRAUD_CHECK_DELAY_MS', 5000),
  unbondingSeconds: number('UNBONDING_SECONDS', 120),
  maxUnbondings: number('MAX_UNBONDINGS', 7),
  maxRedelegations: number('MAX_REDELEGATIONS', 7),
  minDepositFern: number('MIN_DEPOSIT_FERN', 100),
  depositPeriodSeconds: number('DEPOSIT_PERIOD_SECONDS', 300),
  votingPeriodSeconds: number('VOTING_PERIOD_SECONDS', 600),
  voteReminderSeconds: number('VOTE_REMINDER_SECONDS', 120),
  inviteTtlHours: number('INVITE_TTL_HOURS', 72),
  squareRowRevealMs: number('SQUARE_ROW_REVEAL_MS', 100),
};

/** The only configuration the browser is given. */
export const browserSettings = {
  squareRowRevealMs: config.squareRowRevealMs,
  timeZone: config.timeZone,
};
