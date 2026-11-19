/** The one place the environment is read. Every credential and service address comes from the published variables. */

export interface StorageSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface MailSettings {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly timeoutSeconds: number;
}

export interface Config {
  readonly port: number;
  readonly storage: StorageSettings;
  readonly mail: MailSettings;
  readonly gradingKey: string | undefined;
  readonly mediaProbeSeconds: number;
}

const DEFAULT_PORT = 4173;
const DEFAULT_MEDIA_PROBE_SECONDS = 5;
const DEFAULT_MAIL_TIMEOUT_SECONDS = 10;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeSeconds(value: string | undefined, fallback: number): number {
  const seconds = Number(value);
  return value !== undefined && Number.isInteger(seconds) && seconds > 0 ? seconds : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: wholeSeconds(env["APP_PUBLIC_PORT"], DEFAULT_PORT),
    storage: {
      endpoint: required(env, "S3_ENDPOINT"),
      region: required(env, "S3_REGION"),
      bucket: required(env, "S3_BUCKET"),
      forcePathStyle: required(env, "S3_FORCE_PATH_STYLE") === "true",
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
    },
    mail: {
      host: required(env, "SMTP_HOST"),
      port: Number(required(env, "SMTP_PORT")),
      from: required(env, "MAIL_FROM"),
      timeoutSeconds: wholeSeconds(env["MAIL_TIMEOUT_SECONDS"], DEFAULT_MAIL_TIMEOUT_SECONDS),
    },
    gradingKey: env["GRADING_KEY"] === "" ? undefined : env["GRADING_KEY"],
    mediaProbeSeconds: wholeSeconds(env["MEDIA_PROBE_SECONDS"], DEFAULT_MEDIA_PROBE_SECONDS),
  };
}
