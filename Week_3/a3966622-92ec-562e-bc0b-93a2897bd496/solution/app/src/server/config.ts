// The only module that reads the environment. Provider settings have no literal fallback:
// an unset provider variable leaves that provider unreachable, and the app reports it down.
import path from "node:path";
import { fileURLToPath } from "node:url";

const read = (name: string): string => process.env[name]?.trim() ?? "";

const DEFAULT_PORT = 4173;
const DEFAULT_DETENTION_UNIT_SECONDS = 1800;

const positiveInteger = (text: string, fallback: number): number => {
  const value = Number(text);
  return text !== "" && Number.isInteger(value) && value > 0 ? value : fallback;
};

export interface Config {
  port: number;
  appRoot: string;
  killbill: { url: string; username: string; credential: string; apiKey: string; apiSecret: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number; from: string };
  detentionUnitSeconds: number;
}

export function loadConfig(): Config {
  return {
    port: positiveInteger(read("APP_PUBLIC_PORT"), DEFAULT_PORT),
    appRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    killbill: {
      url: read("KILLBILL_URL").replace(/\/+$/, ""),
      username: read("KILLBILL_USERNAME"),
      credential: read("KILLBILL_PASSWORD"),
      apiKey: read("KILLBILL_API_KEY"),
      apiSecret: read("KILLBILL_API_SECRET"),
    },
    s3: {
      endpoint: read("S3_ENDPOINT").replace(/\/+$/, ""),
      region: read("S3_REGION"),
      bucket: read("S3_BUCKET"),
      forcePathStyle: read("S3_FORCE_PATH_STYLE") !== "false",
      accessKeyId: read("S3_ACCESS_KEY_ID"),
      secretAccessKey: read("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: read("SMTP_HOST"), port: positiveInteger(read("SMTP_PORT"), 0), from: read("MAIL_FROM") },
    detentionUnitSeconds: positiveInteger(read("DETENTION_UNIT_SECONDS"), DEFAULT_DETENTION_UNIT_SECONDS),
  };
}
