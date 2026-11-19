import type { AppConfig } from "../shared/api";
import { ttlSeconds } from "../shared/ttl";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number.parseInt(value, 10) : fallback;
}

function ttlChoices(): string[] {
  const choices = (process.env.WRINGBENCH_SHARE_TTL_CHOICES ?? "1h,1d,7d").split(",").map((choice) => choice.trim());
  const bad = choices.filter((choice) => ttlSeconds(choice) === null);
  if (bad.length) throw new Error(`WRINGBENCH_SHARE_TTL_CHOICES has unusable choices: ${bad.join(", ")}`);
  return choices;
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const settings = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  grading: process.env.WRINGBENCH_GRADING === "1",
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    pathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: whole("SMTP_PORT", 1025), from: required("MAIL_FROM") },
  meilisearch: {
    url: required("MEILISEARCH_URL").replace(/\/+$/, ""),
    apiKey: required("MEILISEARCH_API_KEY"),
    index: process.env.WRINGBENCH_SEARCH_INDEX ?? "recipes",
  },
  inviteTtlSeconds: whole("WRINGBENCH_INVITE_TTL_SECONDS", 604800),
  verifyTtlSeconds: whole("WRINGBENCH_VERIFY_TTL_SECONDS", 86400),
};

/** The limits the page obeys, as `GET /api/config` publishes them. */
export const limits: AppConfig = {
  autobakeMs: whole("WRINGBENCH_AUTOBAKE_MS", 300),
  regexBudgetMs: whole("WRINGBENCH_REGEX_BUDGET_MS", 2000),
  inputMaxBytes: whole("WRINGBENCH_INPUT_MAX_BYTES", 2097152),
  fileMaxBytes: whole("WRINGBENCH_FILE_MAX_BYTES", 1048576),
  outputDisplayBytes: whole("WRINGBENCH_OUTPUT_DISPLAY_BYTES", 65536),
  versionsKept: whole("WRINGBENCH_VERSIONS_KEPT", 20),
  teamMax: whole("WRINGBENCH_TEAM_MAX", 5),
  shareTtlChoices: ttlChoices(),
};
