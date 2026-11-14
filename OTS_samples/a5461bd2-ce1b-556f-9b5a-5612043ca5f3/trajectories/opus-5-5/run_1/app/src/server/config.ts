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
  wiremockUrl: string;
  gradingKey: string | null;
  workPageSize: number;
  enquiryLimit: number;
  enquiryWindowSeconds: number;
  intakeTimeoutMs: number;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Environment variable ${name} is not set`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Environment variable ${name} must be a positive integer`);
  return value;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    wiremockUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
    gradingKey: process.env.GRADING_KEY === undefined || process.env.GRADING_KEY === "" ? null : process.env.GRADING_KEY,
    workPageSize: positiveInteger("WORK_PAGE_SIZE", 6),
    enquiryLimit: positiveInteger("ENQUIRY_LIMIT", 3),
    enquiryWindowSeconds: positiveInteger("ENQUIRY_WINDOW_SECONDS", 600),
    intakeTimeoutMs: positiveInteger("INTAKE_TIMEOUT_MS", 5000),
    port: positiveInteger("APP_PUBLIC_PORT", 4173),
  };
}
