/**
 * Every tunable is read from the environment once at start. Nothing here is
 * hard-coded past its published default, and none of the secret values are ever
 * handed to the browser (see `publicLimits`).
 */

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    throw new Error(`${name} must be set`);
  }
  return raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const limits = {
  liveMs: int('FLAN_LIVE_MS', 1000),
  providerTimeoutMs: int('FLAN_PROVIDER_TIMEOUT_MS', 1000),
  catalogRetryS: int('FLAN_CATALOG_RETRY_S', 1),
  motionMs: int('FLAN_MOTION_MS', 150),
  sessionTtlS: int('FLAN_SESSION_TTL_S', 900),
  stepUpTtlS: int('FLAN_STEPUP_TTL_S', 300),
  totpPeriodS: int('FLAN_TOTP_PERIOD_S', 30),
  linkTtlS: int('FLAN_LINK_TTL_S', 600),
  holdGraceS: int('FLAN_HOLD_GRACE_S', 30),
  offerWindowS: int('FLAN_OFFER_WINDOW_S', 172800),
  counterWindowS: int('FLAN_COUNTER_WINDOW_S', 86400),
  closingS: int('FLAN_CLOSING_S', 21600),
  uploadMaxBytes: int('FLAN_UPLOAD_MAX_BYTES', 5000000),
  requestMaxBytes: int('FLAN_REQUEST_MAX_BYTES', 12000000),
  photoMinEdgePx: int('FLAN_PHOTO_MIN_EDGE_PX', 1000),
  photoMaxEdgePx: int('FLAN_PHOTO_MAX_EDGE_PX', 8000),
  photoMaxPixels: int('FLAN_PHOTO_MAX_PIXELS', 40000000),
  correctionMaxChars: int('FLAN_CORRECTION_MAX_CHARS', 80),
  noteMaxChars: int('FLAN_NOTE_MAX_CHARS', 280),
  offerMaxItems: int('FLAN_OFFER_MAX_ITEMS', 3),
  albumMaxHoles: int('FLAN_ALBUM_MAX_HOLES', 200),
  pageMax: int('FLAN_PAGE_MAX', 48),
  syncBatchMax: int('FLAN_SYNC_BATCH_MAX', 50),
  namespaceMaxChars: int('FLAN_NAMESPACE_MAX_CHARS', 64),
  targetMinPx: int('FLAN_TARGET_MIN_PX', 44),
  geometryTolerancePx: num('FLAN_GEOMETRY_TOLERANCE_PX', 2),
  zoomMin: num('FLAN_ZOOM_MIN', 1),
  zoomMax: num('FLAN_ZOOM_MAX', 4),
  zoomStep: num('FLAN_ZOOM_STEP', 0.25),
  gradeClockIso: str('FLAN_GRADE_CLOCK_ISO', '2026-01-01T12:00:00Z'),
} as const;

export type Limits = typeof limits;

/** The subset of limits the browser needs to drive its own controls. */
export const publicLimits = {
  liveMs: limits.liveMs,
  motionMs: limits.motionMs,
  targetMinPx: limits.targetMinPx,
  geometryTolerancePx: limits.geometryTolerancePx,
  zoomMin: limits.zoomMin,
  zoomMax: limits.zoomMax,
  zoomStep: limits.zoomStep,
  uploadMaxBytes: limits.uploadMaxBytes,
  photoMinEdgePx: limits.photoMinEdgePx,
  photoMaxEdgePx: limits.photoMaxEdgePx,
  photoMaxPixels: limits.photoMaxPixels,
  correctionMaxChars: limits.correctionMaxChars,
  noteMaxChars: limits.noteMaxChars,
  offerMaxItems: limits.offerMaxItems,
  pageMax: limits.pageMax,
  syncBatchMax: limits.syncBatchMax,
} as const;

export type PublicLimits = typeof publicLimits;

export const providers = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  keycloak: {
    url: required('KEYCLOAK_URL'),
    realm: required('KEYCLOAK_REALM'),
    issuerUrl: required('AUTH_ISSUER_URL'),
    clientId: required('AUTH_CLIENT_ID'),
    clientSecret: required('AUTH_CLIENT_SECRET'),
  },
  wiremockUrl: required('WIREMOCK_URL'),
} as const;

export const app = {
  port: int('APP_PUBLIC_PORT', 4173),
  publicUrl: str('APP_PUBLIC_URL', `http://127.0.0.1:${int('APP_PUBLIC_PORT', 4173)}`),
  gradeKey: process.env['FLAN_GRADE_KEY'] ?? null,
  defaultNamespace: 'hollowmint',
} as const;
