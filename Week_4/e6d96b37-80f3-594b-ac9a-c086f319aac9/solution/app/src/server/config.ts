// Every setting the server reads, read once at start from the environment.

import { LIMIT_DEFAULTS, UI_LIMIT_KEYS, type LimitName, type Limits, type UiLimits } from "../shared/limits.js";

function text(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function limit(name: LimitName): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : LIMIT_DEFAULTS[name];
}

const limits = Object.fromEntries(
  (Object.keys(LIMIT_DEFAULTS) as LimitName[]).map((name) => [name, limit(name)]),
) as Limits;

const publicUrl = text("APP_PUBLIC_URL", `http://127.0.0.1:${text("APP_PUBLIC_PORT", "4173")}`).replace(/\/+$/, "");

export const config = {
  port: Number(text("APP_PUBLIC_PORT", "4173")),
  publicUrl,
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  keycloak: {
    url: text("KEYCLOAK_URL").replace(/\/+$/, ""),
    realm: text("KEYCLOAK_REALM"),
    issuerUrl: text("AUTH_ISSUER_URL").replace(/\/+$/, ""),
    clientId: text("AUTH_CLIENT_ID"),
    clientSecret: text("AUTH_CLIENT_SECRET"),
  },
  registerUrl: text("WIREMOCK_URL").replace(/\/+$/, ""),
  gradeKey: text("FLAN_GRADE_KEY"),
  gradeClockIso: text("FLAN_GRADE_CLOCK_ISO", "2026-01-01T12:00:00Z"),
  limits,
} as const;

/** The interface limits the browser needs to apply the same rules; never a secret. */
export function uiLimits(): UiLimits {
  return Object.fromEntries(UI_LIMIT_KEYS.map((name) => [name, limits[name]])) as UiLimits;
}

export const DEFAULT_NAMESPACE = "hollowmint";
