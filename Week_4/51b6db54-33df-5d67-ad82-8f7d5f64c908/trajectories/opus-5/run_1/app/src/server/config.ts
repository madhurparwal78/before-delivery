function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', whole('PORT', 4173)),
  publicUrl: text('APP_PUBLIC_URL', ''),
  databaseUrl: text('DATABASE_URL', ''),
  gradingKey: process.env.GRADING_KEY ?? '',
  startAt: process.env.CELMATE_START_AT ?? '',
  paletteMax: whole('CELMATE_PALETTE_MAX', 255),
  spriteMax: whole('CELMATE_SPRITE_MAX', 512),
  frameMinMs: whole('CELMATE_FRAME_MIN_MS', 10),
  frameMaxMs: whole('CELMATE_FRAME_MAX_MS', 65535),
  inviteTtlSeconds: whole('CELMATE_INVITE_TTL_SECONDS', 604800),
  longPressMs: whole('CELMATE_LONG_PRESS_MS', 500),
  presenceVisible: whole('CELMATE_PRESENCE_VISIBLE', 4),
  idleSeconds: whole('CELMATE_IDLE_SECONDS', 300),
  undoDepth: whole('CELMATE_UNDO_DEPTH', 50),
  activityPage: whole('CELMATE_ACTIVITY_PAGE', 50),
  autosaveMs: whole('CELMATE_AUTOSAVE_MS', 1000),
  jobItemMs: whole('CELMATE_JOB_ITEM_MS', 0),
  importMaxBytes: whole('CELMATE_IMPORT_MAX_BYTES', 5000000),
  storage: {
    endpoint: text('S3_ENDPOINT', ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  mail: {
    host: text('SMTP_HOST', ''),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Celmate <no-reply@celmate.example>'),
  },
} as const;

/** The limits the config route publishes; no credential is ever among them. */
export function publicLimits(): Record<string, number> {
  return {
    palette_max: config.paletteMax,
    sprite_max: config.spriteMax,
    frame_min_ms: config.frameMinMs,
    frame_max_ms: config.frameMaxMs,
    invite_ttl_seconds: config.inviteTtlSeconds,
    long_press_ms: config.longPressMs,
    presence_visible: config.presenceVisible,
    idle_seconds: config.idleSeconds,
    undo_depth: config.undoDepth,
    activity_page: config.activityPage,
    autosave_ms: config.autosaveMs,
    job_item_ms: config.jobItemMs,
    import_max_bytes: config.importMaxBytes,
  };
}
