// Settings: names, defaults and runtime overrides (grading route may change them).

export const SETTING_DEFAULTS: Record<string, string | number> = {
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

export const NUMBER_SETTINGS = new Set([
  'ONCALL_ACK_MINUTES', 'WAIT_STEP_UNIT_SECONDS', 'PRESENCE_TIMEOUT_SECONDS',
  'WORKFLOW_LOOP_LIMIT', 'BUSINESS_RULE_DEPTH_LIMIT', 'ASSIGNMENT_CAPACITY',
  'ATTACHMENT_MAX_BYTES', 'ATTACHMENT_QUOTA_BYTES', 'WRITE_RATE_LIMIT_PER_MINUTE',
  'LOGIN_RATE_LIMIT_PER_MINUTE', 'LIST_PAGE_SIZE', 'LIVE_SETTLE_MS',
  'STORAGE_RETRY_SECONDS', 'EXPORT_BATCH_ROWS', 'MAJOR_PROPOSAL_SERVICES',
  'MAJOR_PROPOSAL_INCIDENTS',
]);

export function defaultFor(name: string): string | number {
  const value = SETTING_DEFAULTS[name];
  if (value === undefined) throw new Error(`Unknown setting "${name}"`);
  return value;
}

/** Environment values seed the overrides; grading may replace them at runtime. */
export function envSetting(name: string): string | number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  return NUMBER_SETTINGS.has(name) ? Number(raw) : raw;
}
