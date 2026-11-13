function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function text(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export interface ClientSettings {
  toastMs: number;
  domMarginPx: number;
  domCeiling: number;
}

export const config = {
  port: number('APP_PUBLIC_PORT', 4173),
  databaseUrl: text('DATABASE_URL', ''),
  s3: {
    endpoint: text('S3_ENDPOINT', ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  grading: text('PLOT_GRADING', '') === '1',
  presenceTimeoutMs: number('PLOT_PRESENCE_TIMEOUT_MS', 15000),
  linkTtlMs: number('PLOT_LINK_TTL_MS', 604800000),
  reviewTtlMs: number('PLOT_REVIEW_TTL_MS', 604800000),
  opWindow: number('PLOT_OP_WINDOW', 1000),
  domMarginPx: number('PLOT_DOM_MARGIN_PX', 200),
  domCeiling: number('PLOT_DOM_CEILING', 500),
  underlayMaxBytes: number('PLOT_UNDERLAY_MAX_BYTES', 2000000),
  drawingQuotaBytes: number('PLOT_DRAWING_QUOTA_BYTES', 20000000),
  textMaxBytes: number('PLOT_TEXT_MAX_BYTES', 1000000),
  exportStepMs: number('PLOT_EXPORT_STEP_MS', 400),
  opRate: number('PLOT_OP_RATE', 600),
  loginRate: number('PLOT_LOGIN_RATE', 10),
  toastMs: number('PLOT_TOAST_MS', 5000),
  undoDepth: number('PLOT_UNDO_DEPTH', 100),
} as const;

export const JSON_BODY_LIMIT = 1000000;

export function clientSettings(): ClientSettings {
  return { toastMs: config.toastMs, domMarginPx: config.domMarginPx, domCeiling: config.domCeiling };
}
