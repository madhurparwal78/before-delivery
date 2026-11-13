// Every setting from the environment, with the published defaults.
export interface AppConfig {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKey: string;
    secretKey: string;
  };
  port: number;
  grading: boolean;
  presenceTimeoutMs: number;
  linkTtlMs: number;
  reviewTtlMs: number;
  opWindow: number;
  domMarginPx: number;
  domCeiling: number;
  underlayMaxBytes: number;
  drawingQuotaBytes: number;
  textMaxBytes: number;
  exportStepMs: number;
  opRate: number;
  loginRate: number;
  toastMs: number;
  undoDepth: number;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function configFromEnv(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      accessKey: process.env.S3_ACCESS_KEY_ID ?? '',
      secretKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    port: int(process.env.APP_PUBLIC_PORT, 4173),
    grading: process.env.PLOT_GRADING === '1',
    presenceTimeoutMs: int(process.env.PLOT_PRESENCE_TIMEOUT_MS, 15000),
    linkTtlMs: int(process.env.PLOT_LINK_TTL_MS, 604800000),
    reviewTtlMs: int(process.env.PLOT_REVIEW_TTL_MS, 604800000),
    opWindow: int(process.env.PLOT_OP_WINDOW, 1000),
    domMarginPx: int(process.env.PLOT_DOM_MARGIN_PX, 200),
    domCeiling: int(process.env.PLOT_DOM_CEILING, 500),
    underlayMaxBytes: int(process.env.PLOT_UNDERLAY_MAX_BYTES, 2000000),
    drawingQuotaBytes: int(process.env.PLOT_DRAWING_QUOTA_BYTES, 20000000),
    textMaxBytes: int(process.env.PLOT_TEXT_MAX_BYTES, 1000000),
    exportStepMs: int(process.env.PLOT_EXPORT_STEP_MS, 400),
    opRate: int(process.env.PLOT_OP_RATE, 600),
    loginRate: int(process.env.PLOT_LOGIN_RATE, 10),
    toastMs: int(process.env.PLOT_TOAST_MS, 5000),
    undoDepth: int(process.env.PLOT_UNDO_DEPTH, 100),
  };
}
