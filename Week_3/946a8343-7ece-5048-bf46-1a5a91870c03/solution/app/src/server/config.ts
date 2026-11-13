// The single place that reads the environment. Credentials and published settings never reach the browser.

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Environment variable ${name} must be a non-negative integer`);
  return parsed;
}

function list(name: string, fallback: readonly number[]): number[] {
  const value = process.env[name];
  if (value === undefined || value === "") return [...fallback];
  return value.split(",").map((part) => Number(part.trim()));
}

function hostList(name: string): string[] {
  const value = process.env[name];
  if (value === undefined || value === "") return [];
  return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
}

export const config = {
  port: int("APP_PUBLIC_PORT", 4173),
  grading: process.env["SPUR_GRADING"] === "1",
  databaseUrl: process.env["DATABASE_URL"] ?? "",
  s3: {
    endpoint: process.env["S3_ENDPOINT"] ?? "",
    region: process.env["S3_REGION"] ?? "us-east-1",
    bucket: process.env["S3_BUCKET"] ?? "",
    forcePathStyle: (process.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
    accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "",
  },
  inlineMaxBytes: int("SPUR_INLINE_MAX_BYTES", 65536),
  fileMaxBytes: int("SPUR_FILE_MAX_BYTES", 5000000),
  parallelLimit: int("SPUR_PARALLEL_LIMIT", 4),
  retryMax: int("SPUR_RETRY_MAX", 2),
  jobTimeoutMs: int("SPUR_JOB_TIMEOUT_MS", 3600000),
  artifactTtlMs: int("SPUR_ARTIFACT_TTL_MS", 604800000),
  cacheTtlMs: int("SPUR_CACHE_TTL_MS", 1209600000),
  autoStopMs: int("SPUR_AUTO_STOP_MS", 86400000),
  deployApprovalMs: int("SPUR_DEPLOY_APPROVAL_MS", 86400000),
  retargetLimit: int("SPUR_RETARGET_LIMIT", 4),
  trainMax: int("SPUR_TRAIN_MAX", 20),
  presenceTimeoutMs: int("SPUR_PRESENCE_TIMEOUT_MS", 15000),
  exportStepMs: int("SPUR_EXPORT_STEP_MS", 400),
  exportMaxBytes: int("SPUR_EXPORT_MAX_BYTES", 50000000),
  webhookRetryMs: list("SPUR_WEBHOOK_RETRY_MS", [60000, 300000, 900000]),
  webhookAllow: hostList("SPUR_WEBHOOK_ALLOW"),
  sseHeartbeatMs: int("SPUR_SSE_HEARTBEAT_MS", 15000),
  writeRate: int("SPUR_WRITE_RATE", 600),
  loginRate: int("SPUR_LOGIN_RATE", 10),
  toastMs: int("SPUR_TOAST_MS", 5000),
} as const;

export const LIMITS = {
  jsonBodyBytes: 1_000_000,
  commitBodyBytes: 10_000_000,
} as const;
