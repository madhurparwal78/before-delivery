/** Every credential and service address is read from the environment at start. */

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

const wholeNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a whole positive number`);
  }
  return value;
};

export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface MailConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly timeoutSeconds: number;
}

export interface Config {
  readonly port: number;
  readonly storage: StorageConfig;
  readonly mail: MailConfig;
  readonly gradingKey: string | null;
  readonly mediaProbeSeconds: number;
}

export const loadConfig = (): Config => ({
  port: wholeNumber('APP_PUBLIC_PORT', 4173),
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: wholeNumber('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
    timeoutSeconds: wholeNumber('MAIL_TIMEOUT_SECONDS', 10),
  },
  gradingKey: process.env.GRADING_KEY ?? null,
  mediaProbeSeconds: wholeNumber('MEDIA_PROBE_SECONDS', 5),
});
