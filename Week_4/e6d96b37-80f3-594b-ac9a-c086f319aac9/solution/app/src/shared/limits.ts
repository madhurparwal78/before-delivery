// FLAN_* settings from the brief's "Limits and clocks" table, with their defaults.
// The server reads the environment once (server/config.ts); the browser receives the
// non-secret interface limits (UI_LIMIT_KEYS) embedded in the page by the server.

export const LIMIT_DEFAULTS = {
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
  FLAN_ZOOM_MIN: 1,
  FLAN_ZOOM_MAX: 4,
  FLAN_ZOOM_STEP: 0.25,
} as const;

export type LimitName = keyof typeof LIMIT_DEFAULTS;
export type Limits = { [K in LimitName]: number };

export const UI_LIMIT_KEYS = [
  "FLAN_LIVE_MS",
  "FLAN_MOTION_MS",
  "FLAN_UPLOAD_MAX_BYTES",
  "FLAN_PHOTO_MIN_EDGE_PX",
  "FLAN_PHOTO_MAX_EDGE_PX",
  "FLAN_PHOTO_MAX_PIXELS",
  "FLAN_CORRECTION_MAX_CHARS",
  "FLAN_NOTE_MAX_CHARS",
  "FLAN_OFFER_MAX_ITEMS",
  "FLAN_SYNC_BATCH_MAX",
  "FLAN_TARGET_MIN_PX",
  "FLAN_ZOOM_MIN",
  "FLAN_ZOOM_MAX",
  "FLAN_ZOOM_STEP",
] as const satisfies readonly LimitName[];

type UiLimitName = (typeof UI_LIMIT_KEYS)[number];
export type UiLimits = { [K in UiLimitName]: number };

/** Tray cells, in row-major order, and their size. */
export const CELLS = ["A1", "A2", "B1", "B2"] as const;
export type Cell = (typeof CELLS)[number];
export const CELL_MM = 60;
export const CELL_COLUMNS = 2;
