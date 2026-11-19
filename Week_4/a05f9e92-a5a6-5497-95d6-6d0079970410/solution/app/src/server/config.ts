const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const connection = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  port: Number(env.APP_PUBLIC_PORT ?? 4173),
};

interface Settings {
  GRADING_KEY: string;
  BUSINESS_TIME_ZONE: string;
  ONCALL_ACK_MINUTES: number;
  WAIT_STEP_UNIT_SECONDS: number;
  PRESENCE_TIMEOUT_SECONDS: number;
  WORKFLOW_LOOP_LIMIT: number;
  BUSINESS_RULE_DEPTH_LIMIT: number;
  ASSIGNMENT_CAPACITY: number;
  ATTACHMENT_MAX_BYTES: number;
  ATTACHMENT_QUOTA_BYTES: number;
  WRITE_RATE_LIMIT_PER_MINUTE: number;
  LOGIN_RATE_LIMIT_PER_MINUTE: number;
  LIST_PAGE_SIZE: number;
  LIVE_SETTLE_MS: number;
  STORAGE_RETRY_SECONDS: number;
  EXPORT_BATCH_ROWS: number;
  MAJOR_PROPOSAL_SERVICES: number;
  MAJOR_PROPOSAL_INCIDENTS: number;
}

type SettingName = keyof Settings;

const defaults: Settings = {
  GRADING_KEY: "switchyard-grading-local",
  BUSINESS_TIME_ZONE: "Europe/Berlin",
  ONCALL_ACK_MINUTES: 15,
  WAIT_STEP_UNIT_SECONDS: 60,
  PRESENCE_TIMEOUT_SECONDS: 30,
  WORKFLOW_LOOP_LIMIT: 100,
  BUSINESS_RULE_DEPTH_LIMIT: 5,
  ASSIGNMENT_CAPACITY: 10,
  ATTACHMENT_MAX_BYTES: 5_000_000,
  ATTACHMENT_QUOTA_BYTES: 20_000_000,
  WRITE_RATE_LIMIT_PER_MINUTE: 600,
  LOGIN_RATE_LIMIT_PER_MINUTE: 10,
  LIST_PAGE_SIZE: 20,
  LIVE_SETTLE_MS: 200,
  STORAGE_RETRY_SECONDS: 10,
  EXPORT_BATCH_ROWS: 50,
  MAJOR_PROPOSAL_SERVICES: 2,
  MAJOR_PROPOSAL_INCIDENTS: 3,
};

export const SETTING_NAMES = Object.keys(defaults) as SettingName[];

function fromEnvironment(): Settings {
  const out: Record<string, string | number> = { ...defaults };
  for (const name of SETTING_NAMES) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    out[name] = typeof defaults[name] === "number" ? Number(raw) : raw;
  }
  return out as unknown as Settings;
}

export const settings: Settings = fromEnvironment();

export function resetSettings(): void {
  Object.assign(settings, fromEnvironment());
}

export function isSettingName(name: string): name is SettingName {
  return (SETTING_NAMES as string[]).includes(name);
}

export function applySetting(name: SettingName, value: string | number): void {
  const target = settings as unknown as Record<string, string | number>;
  target[name] = typeof defaults[name] === "number" ? Number(value) : String(value);
}
