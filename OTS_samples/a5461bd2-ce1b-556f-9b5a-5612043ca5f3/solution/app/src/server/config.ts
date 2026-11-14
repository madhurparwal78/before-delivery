/** Every service address, credential and setting is read from the environment here, once, at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number of 1 or more`);
  return value;
}

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  intakeUrl: string;
  gradingKey: string | undefined;
  workPageSize: number;
  enquiryLimit: number;
  enquiryWindowSeconds: number;
  intakeTimeoutMs: number;
}

export function readConfig(): Config {
  return {
    port: wholeNumber("APP_PUBLIC_PORT", 4173),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    intakeUrl: required("WIREMOCK_URL"),
    gradingKey: process.env.GRADING_KEY || undefined,
    workPageSize: wholeNumber("WORK_PAGE_SIZE", 6),
    enquiryLimit: wholeNumber("ENQUIRY_LIMIT", 3),
    enquiryWindowSeconds: wholeNumber("ENQUIRY_WINDOW_SECONDS", 600),
    intakeTimeoutMs: wholeNumber("INTAKE_TIMEOUT_MS", 5000),
  };
}
