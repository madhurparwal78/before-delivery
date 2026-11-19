import { ttlLabel, ttlSeconds } from '../shared/text.js';
import type { Config } from './types.js';

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** The one place environment values are read (DP-02). */
export function loadConfig(): Config {
  const port = int('APP_PUBLIC_PORT', 4173);
  const publicUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ?? `http://localhost:${port}`;
  const shareTtlChoices = (process.env.WRINGBENCH_SHARE_TTL_CHOICES ?? '1h,1d,7d')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9]+[smhd]$/.test(s));
  return {
    port,
    publicUrl,
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: { host: process.env.SMTP_HOST ?? '', port: int('SMTP_PORT', 1025), from: process.env.MAIL_FROM ?? 'Wringbench <hello@wringbench.test>' },
    meili: { url: process.env.MEILISEARCH_URL ?? '', apiKey: process.env.MEILISEARCH_API_KEY ?? '', index: process.env.WRINGBENCH_SEARCH_INDEX ?? 'recipes' },
    autobakeMs: int('WRINGBENCH_AUTOBAKE_MS', 300),
    regexBudgetMs: int('WRINGBENCH_REGEX_BUDGET_MS', 2000),
    inputMaxBytes: int('WRINGBENCH_INPUT_MAX_BYTES', 2097152),
    fileMaxBytes: int('WRINGBENCH_FILE_MAX_BYTES', 1048576),
    outputDisplayBytes: int('WRINGBENCH_OUTPUT_DISPLAY_BYTES', 65536),
    versionsKept: int('WRINGBENCH_VERSIONS_KEPT', 20),
    teamMax: int('WRINGBENCH_TEAM_MAX', 5),
    shareTtlChoices,
    inviteTtlSeconds: int('WRINGBENCH_INVITE_TTL_SECONDS', 604800),
    verifyTtlSeconds: int('WRINGBENCH_VERIFY_TTL_SECONDS', 86400),
    grading: process.env.WRINGBENCH_GRADING === '1',
  };
}

export function clientConfig(c: Config): Record<string, unknown> {
  const labels: Record<string, string> = {};
  for (const t of c.shareTtlChoices) labels[t] = ttlLabel(t);
  return {
    autobakeMs: c.autobakeMs,
    regexBudgetMs: c.regexBudgetMs,
    inputMaxBytes: c.inputMaxBytes,
    fileMaxBytes: c.fileMaxBytes,
    outputDisplayBytes: c.outputDisplayBytes,
    versionsKept: c.versionsKept,
    teamMax: c.teamMax,
    shareTtlChoices: c.shareTtlChoices,
    shareTtlLabels: labels,
  };
}

export { ttlSeconds };
export type { Config };
export { config } from './types.js';
