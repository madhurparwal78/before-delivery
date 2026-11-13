// The only module that reads the environment. Every service URL and credential comes from here.

import { isTimeZone } from "../shared/clock.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} must be set`);
  return value.trim();
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name];
  if ((raw === undefined || raw.trim() === "") && fallback !== undefined) return fallback;
  const value = Number(required(name));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

function timeZone(): string {
  const zone = process.env.KITCHEN_TIME_ZONE?.trim() || "America/Chicago";
  if (!isTimeZone(zone)) throw new Error(`KITCHEN_TIME_ZONE ${zone} is not an IANA time zone`);
  return zone;
}

function databaseUrl(): string {
  const url = required("DATABASE_URL");
  if (new URL(url).port === "") throw new Error("DATABASE_URL must name its port");
  return url;
}

export const config = {
  port: positiveInteger("APP_PUBLIC_PORT", 4173),
  databaseUrl: databaseUrl(),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: positiveInteger("SMTP_PORT"),
  },
  mailFrom: required("MAIL_FROM"),
  timeZone: timeZone(),
  holdSeconds: positiveInteger("HOLD_SECONDS", 90),
  expirySweepSeconds: positiveInteger("EXPIRY_SWEEP_SECONDS", 3600),
  signinWindowSeconds: positiveInteger("SIGNIN_WINDOW_SECONDS", 900),
  reauthSeconds: positiveInteger("REAUTH_SECONDS", 300),
} as const;
