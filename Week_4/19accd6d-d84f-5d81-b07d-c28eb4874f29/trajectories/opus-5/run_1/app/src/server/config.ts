import { parseTtl, type TtlChoice } from '../shared/format.js';

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

function ttlChoices(): TtlChoice[] {
  const raw = text('WRINGBENCH_SHARE_TTL_CHOICES', '1h,1d,7d');
  const choices: TtlChoice[] = [];
  for (const part of raw.split(',')) {
    const choice = parseTtl(part);
    if (choice === null) throw new Error(`WRINGBENCH_SHARE_TTL_CHOICES holds an unreadable choice: ${part}`);
    choices.push(choice);
  }
  return choices;
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Wringbench <hello@wringbench.test>'),
  },
  search: {
    url: required('MEILISEARCH_URL').replace(/\/$/, ''),
    apiKey: text('MEILISEARCH_API_KEY', ''),
    index: text('WRINGBENCH_SEARCH_INDEX', 'recipes'),
  },
  limits: {
    autobakeMs: whole('WRINGBENCH_AUTOBAKE_MS', 300),
    regexBudgetMs: whole('WRINGBENCH_REGEX_BUDGET_MS', 2000),
    inputMaxBytes: whole('WRINGBENCH_INPUT_MAX_BYTES', 2097152),
    fileMaxBytes: whole('WRINGBENCH_FILE_MAX_BYTES', 1048576),
    outputDisplayBytes: whole('WRINGBENCH_OUTPUT_DISPLAY_BYTES', 65536),
    versionsKept: whole('WRINGBENCH_VERSIONS_KEPT', 20),
    teamMax: whole('WRINGBENCH_TEAM_MAX', 5),
    shareTtlChoices: ttlChoices(),
    inviteTtlSeconds: whole('WRINGBENCH_INVITE_TTL_SECONDS', 604800),
    verifyTtlSeconds: whole('WRINGBENCH_VERIFY_TTL_SECONDS', 86400),
  },
  gradingEnabled: process.env['WRINGBENCH_GRADING'] === '1',
} as const;

export const bodyLimits = {
  json: 1_000_000,
  snapshot: 3_000_000,
  file: config.limits.fileMaxBytes,
  gradingSeed: 10_000_000,
} as const;

/** The client-side limits returned by GET /api/config. */
export function clientConfig(): Record<string, unknown> {
  return {
    autobakeMs: config.limits.autobakeMs,
    regexBudgetMs: config.limits.regexBudgetMs,
    inputMaxBytes: config.limits.inputMaxBytes,
    fileMaxBytes: config.limits.fileMaxBytes,
    outputDisplayBytes: config.limits.outputDisplayBytes,
    versionsKept: config.limits.versionsKept,
    teamMax: config.limits.teamMax,
    shareTtlChoices: config.limits.shareTtlChoices.map((choice) => choice.code),
  };
}
