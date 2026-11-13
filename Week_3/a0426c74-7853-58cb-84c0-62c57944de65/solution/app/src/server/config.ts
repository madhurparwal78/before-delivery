// Every environment variable the server reads, read once at start. Defaults are the published ones;
// service credentials and URLs have none.

function text(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  grading: text('PLOT_GRADING') === '1',
  presenceTimeoutMs: whole('PLOT_PRESENCE_TIMEOUT_MS', 15000),
  linkTtlMs: whole('PLOT_LINK_TTL_MS', 604800000),
  reviewTtlMs: whole('PLOT_REVIEW_TTL_MS', 604800000),
  opWindow: whole('PLOT_OP_WINDOW', 1000),
  domMarginPx: whole('PLOT_DOM_MARGIN_PX', 200),
  domCeiling: whole('PLOT_DOM_CEILING', 500),
  underlayMaxBytes: whole('PLOT_UNDERLAY_MAX_BYTES', 2000000),
  drawingQuotaBytes: whole('PLOT_DRAWING_QUOTA_BYTES', 20000000),
  textMaxBytes: whole('PLOT_TEXT_MAX_BYTES', 1000000),
  exportStepMs: whole('PLOT_EXPORT_STEP_MS', 400),
  opRate: whole('PLOT_OP_RATE', 600),
  loginRate: whole('PLOT_LOGIN_RATE', 10),
  toastMs: whole('PLOT_TOAST_MS', 5000),
  undoDepth: whole('PLOT_UNDO_DEPTH', 100),
} as const;

/** JSON request bodies may be this long; the limit itself is allowed (Server boundary). */
export const JSON_LIMIT_BYTES = 1000000;
