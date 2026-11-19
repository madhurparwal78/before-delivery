import { cleanLocalTime } from '../src-shared/domain.js';

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly killbill: { readonly url: string; readonly username: string; readonly password: string; readonly apiKey: string; readonly apiSecret: string };
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly timing: {
    readonly trialLengthSeconds: number;
    readonly trialNoticeLeadSeconds: number;
    readonly billingCallbackToleranceSeconds: number;
    readonly idempotencyTtlSeconds: number;
    readonly sessionTtlSeconds: number;
  };
}

const intEnv = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/** Every credential and service URL comes from the environment, read once at start. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl === '') throw new Error('DATABASE_URL is not set');
  return {
    port: intEnv(env.APP_PUBLIC_PORT, 4173),
    databaseUrl,
    killbill: {
      url: env.KILLBILL_URL ?? '',
      username: env.KILLBILL_USERNAME ?? '',
      password: env.KILLBILL_PASSWORD ?? '',
      apiKey: env.KILLBILL_API_KEY ?? '',
      apiSecret: env.KILLBILL_API_SECRET ?? '',
    },
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: intEnv(env.SMTP_PORT, 25),
      from: env.MAIL_FROM ?? 'Tidemark Daybook <daybook@tidemark.test>',
    },
    timing: {
      trialLengthSeconds: intEnv(env.TRIAL_LENGTH_SECONDS, 1_209_600),
      trialNoticeLeadSeconds: intEnv(env.TRIAL_NOTICE_LEAD_SECONDS, 259_200),
      billingCallbackToleranceSeconds: intEnv(env.BILLING_CALLBACK_TOLERANCE_SECONDS, 300),
      idempotencyTtlSeconds: intEnv(env.IDEMPOTENCY_TTL_SECONDS, 86_400),
      sessionTtlSeconds: intEnv(env.SESSION_TTL_SECONDS, 2_592_000),
    },
  };
}

export const DEFAULT_ZONE = 'UTC';

/** Start times for routines and calendar slots must be whole minutes. */
export const cleanClockTime = (value: unknown): string => cleanLocalTime(value, 'Start time');
