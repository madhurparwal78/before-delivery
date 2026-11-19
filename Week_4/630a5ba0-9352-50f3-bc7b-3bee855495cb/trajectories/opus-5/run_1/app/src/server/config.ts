function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  }
  return Math.floor(parsed);
}

export interface Config {
  databaseUrl: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  mail: { host: string; port: number; from: string };
  port: number;
  trialLengthSeconds: number;
  trialNoticeLeadSeconds: number;
  billingCallbackToleranceSeconds: number;
  idempotencyTtlSeconds: number;
  sessionTtlSeconds: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  trialLengthSeconds: seconds('TRIAL_LENGTH_SECONDS', 1_209_600),
  trialNoticeLeadSeconds: seconds('TRIAL_NOTICE_LEAD_SECONDS', 259_200),
  billingCallbackToleranceSeconds: seconds('BILLING_CALLBACK_TOLERANCE_SECONDS', 300),
  idempotencyTtlSeconds: seconds('IDEMPOTENCY_TTL_SECONDS', 86_400),
  sessionTtlSeconds: seconds('SESSION_TTL_SECONDS', 2_592_000),
};
