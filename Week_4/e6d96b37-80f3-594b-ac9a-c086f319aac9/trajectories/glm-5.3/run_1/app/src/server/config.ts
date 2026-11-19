import type { FlanEnv } from "../shared/env.js";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number`);
  return parsed;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw;
}

export function loadConfig(): FlanEnv {
  const gradeKey = process.env.FLAN_GRADE_KEY ?? null;
  const defaults = {
    FLAN_LIVE_MS: 1000,
    FLAN_PROVIDER_TIMEOUT_MS: 1000,
    FLAN_CATALOG_RETRY_S: 1,
    FLAN_MOTION_MS: 150,
    FLAN_SESSION_TTL_S: 900,
    FLAN_STEPUP_TTL_S: 300,
    FLAN_TOTP_PERIOD_S: 30,
    FLAN_LINK_TTL_S: 600,
    FLAN_HOLD_GRACE_S: 30,
    FLAN_OFFER_WINDOW_S: 172800,
    FLAN_COUNTER_WINDOW_S: 86400,
    FLAN_CLOSING_S: 21600,
    FLAN_UPLOAD_MAX_BYTES: 5000000,
    FLAN_REQUEST_MAX_BYTES: 12000000,
    FLAN_PHOTO_MIN_EDGE_PX: 1000,
    FLAN_PHOTO_MAX_EDGE_PX: 8000,
    FLAN_PHOTO_MAX_PIXELS: 40000000,
    FLAN_CORRECTION_MAX_CHARS: 80,
    FLAN_NOTE_MAX_CHARS: 280,
    FLAN_OFFER_MAX_ITEMS: 3,
    FLAN_ALBUM_MAX_HOLES: 200,
    FLAN_PAGE_MAX: 48,
    FLAN_SYNC_BATCH_MAX: 50,
    FLAN_NAMESPACE_MAX_CHARS: 64,
    FLAN_TARGET_MIN_PX: 44,
    FLAN_GEOMETRY_TOLERANCE_PX: 2,
  } as const;
  return {
    FLAN_GRADE_KEY: gradeKey,
    FLAN_LIVE_MS: intEnv("FLAN_LIVE_MS", defaults.FLAN_LIVE_MS),
    FLAN_PROVIDER_TIMEOUT_MS: intEnv("FLAN_PROVIDER_TIMEOUT_MS", defaults.FLAN_PROVIDER_TIMEOUT_MS),
    FLAN_CATALOG_RETRY_S: intEnv("FLAN_CATALOG_RETRY_S", defaults.FLAN_CATALOG_RETRY_S),
    FLAN_MOTION_MS: intEnv("FLAN_MOTION_MS", defaults.FLAN_MOTION_MS),
    FLAN_SESSION_TTL_S: intEnv("FLAN_SESSION_TTL_S", defaults.FLAN_SESSION_TTL_S),
    FLAN_STEPUP_TTL_S: intEnv("FLAN_STEPUP_TTL_S", defaults.FLAN_STEPUP_TTL_S),
    FLAN_TOTP_PERIOD_S: intEnv("FLAN_TOTP_PERIOD_S", defaults.FLAN_TOTP_PERIOD_S),
    FLAN_LINK_TTL_S: intEnv("FLAN_LINK_TTL_S", defaults.FLAN_LINK_TTL_S),
    FLAN_HOLD_GRACE_S: intEnv("FLAN_HOLD_GRACE_S", defaults.FLAN_HOLD_GRACE_S),
    FLAN_OFFER_WINDOW_S: intEnv("FLAN_OFFER_WINDOW_S", defaults.FLAN_OFFER_WINDOW_S),
    FLAN_COUNTER_WINDOW_S: intEnv("FLAN_COUNTER_WINDOW_S", defaults.FLAN_COUNTER_WINDOW_S),
    FLAN_CLOSING_S: intEnv("FLAN_CLOSING_S", defaults.FLAN_CLOSING_S),
    FLAN_UPLOAD_MAX_BYTES: intEnv("FLAN_UPLOAD_MAX_BYTES", defaults.FLAN_UPLOAD_MAX_BYTES),
    FLAN_REQUEST_MAX_BYTES: intEnv("FLAN_REQUEST_MAX_BYTES", defaults.FLAN_REQUEST_MAX_BYTES),
    FLAN_PHOTO_MIN_EDGE_PX: intEnv("FLAN_PHOTO_MIN_EDGE_PX", defaults.FLAN_PHOTO_MIN_EDGE_PX),
    FLAN_PHOTO_MAX_EDGE_PX: intEnv("FLAN_PHOTO_MAX_EDGE_PX", defaults.FLAN_PHOTO_MAX_EDGE_PX),
    FLAN_PHOTO_MAX_PIXELS: intEnv("FLAN_PHOTO_MAX_PIXELS", defaults.FLAN_PHOTO_MAX_PIXELS),
    FLAN_CORRECTION_MAX_CHARS: intEnv("FLAN_CORRECTION_MAX_CHARS", defaults.FLAN_CORRECTION_MAX_CHARS),
    FLAN_NOTE_MAX_CHARS: intEnv("FLAN_NOTE_MAX_CHARS", defaults.FLAN_NOTE_MAX_CHARS),
    FLAN_OFFER_MAX_ITEMS: intEnv("FLAN_OFFER_MAX_ITEMS", defaults.FLAN_OFFER_MAX_ITEMS),
    FLAN_ALBUM_MAX_HOLES: intEnv("FLAN_ALBUM_MAX_HOLES", defaults.FLAN_ALBUM_MAX_HOLES),
    FLAN_PAGE_MAX: intEnv("FLAN_PAGE_MAX", defaults.FLAN_PAGE_MAX),
    FLAN_SYNC_BATCH_MAX: intEnv("FLAN_SYNC_BATCH_MAX", defaults.FLAN_SYNC_BATCH_MAX),
    FLAN_NAMESPACE_MAX_CHARS: intEnv("FLAN_NAMESPACE_MAX_CHARS", defaults.FLAN_NAMESPACE_MAX_CHARS),
    FLAN_TARGET_MIN_PX: intEnv("FLAN_TARGET_MIN_PX", defaults.FLAN_TARGET_MIN_PX),
    FLAN_GEOMETRY_TOLERANCE_PX: intEnv("FLAN_GEOMETRY_TOLERANCE_PX", defaults.FLAN_GEOMETRY_TOLERANCE_PX),
    FLAN_ZOOM_MIN: floatEnv("FLAN_ZOOM_MIN", 1),
    FLAN_ZOOM_MAX: floatEnv("FLAN_ZOOM_MAX", 4),
    FLAN_ZOOM_STEP: floatEnv("FLAN_ZOOM_STEP", 0.25),
    FLAN_GRADE_CLOCK_ISO: strEnv("FLAN_GRADE_CLOCK_ISO", "2026-01-01T12:00:00Z"),
    APP_PUBLIC_PORT: intEnv("APP_PUBLIC_PORT", 4173),
    APP_PUBLIC_URL: strEnv("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
    DATABASE_URL: strEnv("DATABASE_URL", "postgresql://localhost:5432/flan"),
    S3_ENDPOINT: strEnv("S3_ENDPOINT", "http://localhost:9000"),
    S3_REGION: strEnv("S3_REGION", "us-east-1"),
    S3_BUCKET: strEnv("S3_BUCKET", "flan"),
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE !== "false",
    S3_ACCESS_KEY_ID: strEnv("S3_ACCESS_KEY_ID", "minioadmin"),
    S3_SECRET_ACCESS_KEY: strEnv("S3_SECRET_ACCESS_KEY", "minioadmin"),
    KEYCLOAK_URL: strEnv("KEYCLOAK_URL", "http://localhost:8080"),
    KEYCLOAK_REALM: strEnv("KEYCLOAK_REALM", "master"),
    AUTH_ISSUER_URL: strEnv("AUTH_ISSUER_URL", ""),
    AUTH_CLIENT_ID: strEnv("AUTH_CLIENT_ID", "app"),
    AUTH_CLIENT_SECRET: strEnv("AUTH_CLIENT_SECRET", ""),
    WIREMOCK_URL: strEnv("WIREMOCK_URL", "http://localhost:8080"),
  };
}

export function cssTokens(env: FlanEnv): string {
  return `:root{--flan-target-min:${env.FLAN_TARGET_MIN_PX}px;--flan-motion:${env.FLAN_MOTION_MS}ms;}`;
}
