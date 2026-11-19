/**
 * Environment-backed connections and runtime settings.
 * Values are read from the environment at start and never hard-coded.
 */

export interface Connections {
  readonly databaseUrl: string;
  readonly port: number;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const connections: Connections = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
};

export interface Settings {
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

const settingDefaults: Settings = {
  GRADING_KEY: 'switchyard-grading-local',
  BUSINESS_TIME_ZONE: 'Europe/Berlin',
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

export type SettingName = keyof Settings;

const numericSettings = new Set<SettingName>(
  (Object.keys(settingDefaults) as SettingName[]).filter((k) => typeof settingDefaults[k] === 'number'),
);

/** Settings as the environment set them; the grading route restores to these. */
export const environmentSettings: Settings = (() => {
  const base = { ...settingDefaults };
  for (const name of Object.keys(settingDefaults) as SettingName[]) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    if (numericSettings.has(name)) {
      const n = Number(raw);
      if (Number.isFinite(n)) (base as Record<SettingName, string | number>)[name] = n;
    } else {
      (base as Record<SettingName, string | number>)[name] = raw;
    }
  }
  return base;
})();

const current: Settings = { ...environmentSettings };

export function settings(): Settings {
  return current;
}

export function isSettingName(name: string): name is SettingName {
  return Object.prototype.hasOwnProperty.call(settingDefaults, name);
}

export function applySettings(values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!isSettingName(name)) continue;
    if (numericSettings.has(name)) {
      const n = Number(value);
      if (Number.isFinite(n)) (current as Record<SettingName, string | number>)[name] = n;
    } else if (typeof value === 'string') {
      (current as Record<SettingName, string | number>)[name] = value;
    }
  }
}

export function resetSettings(): void {
  Object.assign(current, environmentSettings);
}

/** A byte limit written with comma thousands separators, for example 5,000,000. */
export function withThousands(n: number): string {
  return n.toLocaleString('en-US');
}
